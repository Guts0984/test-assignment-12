import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { PG, asPgError, schema } from '../src/index.js';
import { MIN, T, apptValues, createTestDb, insertAppt, makeWorld, type TestDb, type World } from './helpers.js';

let t: TestDb;
let w: World;
// Wednesday 2026-06-10 09:00 Kyiv (UTC+3)
const NINE = T('2026-06-10T06:00:00Z');
const at = (minutes: number): Date => new Date(NINE.getTime() + minutes * MIN);

beforeAll(async () => {
  t = await createTestDb();
  w = await makeWorld(t.db);
});
afterAll(async () => {
  await t.drop();
});

const tryInsert = async (a: Parameters<typeof insertAppt>[1]) => {
  try {
    await insertAppt(t.db, a);
    return null;
  } catch (e) {
    return asPgError(e);
  }
};

const base = (i: number) => ({
  patientId: w.patients[i] as string,
  doctorId: w.doctors[0] as string,
  clinicId: w.kyiv,
  serviceId: w.consult30,
  startsAt: at(0),
  minutes: 30,
});

describe('invariant 1: a doctor never sees two visits at once', () => {
  it('20 connections race for one slot: exactly one wins, 19 get an exclusion violation', async () => {
    const day = (k: number) => new Date(NINE.getTime() + k * 86_400_000);
    const results = await Promise.all(
      Array.from({ length: 20 }, async (_, i) => {
        try {
          await insertAppt(t.db, { ...base(i), startsAt: day(1) });
          return 'ok';
        } catch (e) {
          const err = asPgError(e);
          return `${err?.code}:${err?.constraint}`;
        }
      }),
    );
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    const losers = results.filter((r) => r !== 'ok');
    expect(losers).toHaveLength(19);
    for (const l of losers) expect(l).toBe(`${PG.EXCLUSION_VIOLATION}:appointments_doctor_no_overlap`);
    const n = await t.db.execute(sql`SELECT count(*)::int AS n FROM appointments WHERE starts_at = ${day(1).toISOString()}::timestamptz`);
    expect((n.rows[0] as { n: number }).n).toBe(1);
  });

  it('overlap in the middle of a visit is rejected, whatever the service', async () => {
    await insertAppt(t.db, { ...base(1), doctorId: w.doctors[1] as string, startsAt: at(0) });
    const e = await tryInsert({ ...base(2), doctorId: w.doctors[1] as string, startsAt: at(15), serviceId: w.quick15, minutes: 15 });
    expect(e?.code).toBe(PG.EXCLUSION_VIOLATION);
  });

  it('the 5-minute preparation counts: a 15-min visit blocks until +20, so +15 is taken and +30 is free', async () => {
    const doc = w.doctors[2] as string;
    await insertAppt(t.db, { ...base(3), doctorId: doc, serviceId: w.quick15, minutes: 15, startsAt: at(0) });
    const clash = await tryInsert({ ...base(4), doctorId: doc, serviceId: w.quick15, minutes: 15, startsAt: at(15) });
    expect(clash?.constraint).toBe('appointments_doctor_no_overlap');
    expect(await tryInsert({ ...base(4), doctorId: doc, serviceId: w.quick15, minutes: 15, startsAt: at(30) })).toBeNull();
  });

  it('a cancelled visit frees the slot for ever', async () => {
    const doc = w.doctors[3] as string;
    const id = await insertAppt(t.db, { ...base(5), doctorId: doc, startsAt: at(60) });
    await t.db.execute(sql`UPDATE appointments SET status = 'cancelled' WHERE id = ${id}::uuid`);
    expect(await tryInsert({ ...base(6), doctorId: doc, startsAt: at(60) })).toBeNull();
  });

  it('random storm: 200 attempts over 10 slots by 40 patients never produce an overlap', async () => {
    const doc = w.doctors[4] as string;
    const day = new Date(NINE.getTime() + 5 * 86_400_000);
    await Promise.all(
      Array.from({ length: 200 }, (_, i) =>
        tryInsert({
          patientId: w.patients[i % 40] as string,
          doctorId: doc,
          clinicId: w.kyiv,
          serviceId: w.consult30,
          startsAt: new Date(day.getTime() + (i % 10) * 45 * MIN),
          minutes: 30,
        }),
      ),
    );
    const r = await t.db.execute(sql`
      SELECT count(*)::int AS n FROM appointments a JOIN appointments b
        ON a.doctor_id = b.doctor_id AND a.id < b.id AND a.status <> 'cancelled' AND b.status <> 'cancelled'
       AND tstzrange(a.starts_at, a.occupied_until) && tstzrange(b.starts_at, b.occupied_until)
      WHERE a.doctor_id = ${doc}::uuid`);
    expect((r.rows[0] as { n: number }).n).toBe(0);
    const n = await t.db.execute(sql`SELECT count(*)::int AS n FROM appointments WHERE doctor_id = ${doc}::uuid`);
    expect((n.rows[0] as { n: number }).n).toBe(10);
  });
});

describe('invariant 1 under genuinely simultaneous transactions', () => {
  it('20 transactions each hold the row for 300ms before commit: they overlap in time, still one winner', async () => {
    const day = new Date(NINE.getTime() + 40 * 86_400_000);
    const started = Date.now();
    const results = await Promise.all(
      Array.from({ length: 20 }, async (_, i) => {
        const c = await t.pool.connect();
        try {
          await c.query('BEGIN');
          const v = apptValues({ ...base(i), startsAt: day });
          await c.query(
            `INSERT INTO appointments (patient_id, doctor_id, clinic_id, service_id, starts_at, ends_at, occupied_until, local_date, status, price_minor, currency)
             VALUES ($1,$2,$3,$4,$5,$6,$6,'2000-01-01','booked',1000,'UAH')`,
            [v.patientId, v.doctorId, v.clinicId, v.serviceId, v.startsAt, v.endsAt],
          );
          await c.query('SELECT pg_sleep(0.3)');
          await c.query('COMMIT');
          return 'ok';
        } catch (e) {
          await c.query('ROLLBACK').catch(() => undefined);
          return asPgError(e)?.code ?? 'unknown';
        } finally {
          c.release();
        }
      }),
    );
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r === PG.EXCLUSION_VIOLATION)).toHaveLength(19);
    // serialized execution would take 20 * 0.3s = 6s; real concurrency finishes in about one sleep
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe('invariant 2: one ultrasound room per clinic', () => {
  it('two doctors, same time, both need UZI: one wins, in 8 independent rounds', async () => {
    // Losers see either an exclusion violation or, when transactions wait on each other across the
    // three exclusion indexes, a deadlock abort (40P01). Both mean "not booked"; the engine must
    // treat both as SLOT_TAKEN. What must never happen: two winners, or any other error.
    for (let round = 0; round < 8; round++) {
      const day = new Date(NINE.getTime() + (50 + round) * 86_400_000);
      const res = await Promise.all(
        [0, 1, 2, 3, 4, 5].map((i) =>
          tryInsert({ ...base(10 + i), doctorId: w.doctors[i] as string, serviceId: w.uzi30, startsAt: day, minutes: 30 }),
        ),
      );
      expect(res.filter((r) => r === null), `round ${round}`).toHaveLength(1);
      for (const r of res.filter((x) => x !== null)) expect([PG.EXCLUSION_VIOLATION, PG.DEADLOCK]).toContain(r?.code);
      const n = await t.db.execute(sql`SELECT count(*)::int AS n FROM appointments WHERE room_id = ${w.uziRoomKyiv}::uuid AND starts_at = ${day.toISOString()}::timestamptz AND status <> 'cancelled'`);
      expect((n.rows[0] as { n: number }).n).toBe(1);
    }
  });

  it('the room is set by the database even when the caller passes none (or the wrong one)', async () => {
    const day = new Date(NINE.getTime() + 9 * 86_400_000);
    const id = await insertAppt(t.db, { ...base(20), doctorId: w.doctors[0] as string, serviceId: w.uzi45, startsAt: day, minutes: 45, roomId: null });
    const r = await t.db.execute(sql`SELECT room_id FROM appointments WHERE id = ${id}::uuid`);
    expect((r.rows[0] as { room_id: string }).room_id).toBe(w.uziRoomKyiv);
    // a malicious caller supplies a bogus room on a non-UZI visit: it is wiped
    const id2 = await insertAppt(t.db, { ...base(21), doctorId: w.doctors[1] as string, serviceId: w.consult30, startsAt: day, minutes: 30, roomId: w.uziRoomKyiv });
    const r2 = await t.db.execute(sql`SELECT room_id FROM appointments WHERE id = ${id2}::uuid`);
    expect((r2.rows[0] as { room_id: string | null }).room_id).toBeNull();
  });

  it('the room includes the 5-minute cleanup, and non-UZI visits are not blocked by it', async () => {
    const day = new Date(NINE.getTime() + 10 * 86_400_000);
    await insertAppt(t.db, { ...base(22), doctorId: w.doctors[0] as string, serviceId: w.uzi30, startsAt: day, minutes: 30 });
    const clash = await tryInsert({ ...base(23), doctorId: w.doctors[1] as string, serviceId: w.uzi30, startsAt: new Date(day.getTime() + 30 * MIN), minutes: 30 });
    expect(clash?.constraint).toBe('appointments_room_no_overlap');
    expect(await tryInsert({ ...base(23), doctorId: w.doctors[1] as string, serviceId: w.consult30, startsAt: day, minutes: 30 })).toBeNull();
    expect(await tryInsert({ ...base(24), doctorId: w.doctors[2] as string, serviceId: w.uzi30, startsAt: new Date(day.getTime() + 45 * MIN), minutes: 30 })).toBeNull();
  });

  it('another clinic has its own room', async () => {
    const day = new Date(NINE.getTime() + 11 * 86_400_000);
    await insertAppt(t.db, { ...base(25), doctorId: w.doctors[0] as string, serviceId: w.uzi30, startsAt: day, minutes: 30 });
    expect(await tryInsert({ ...base(26), doctorId: w.warsawDoctor, clinicId: w.warsaw, serviceId: w.uzi30, startsAt: day, minutes: 30 })).toBeNull();
  });
});

describe('invariant 3: a patient is not in two places', () => {
  it('same patient, two doctors, overlapping times: rejected', async () => {
    const day = new Date(NINE.getTime() + 12 * 86_400_000);
    await insertAppt(t.db, { ...base(30), doctorId: w.doctors[0] as string, startsAt: day });
    const e = await tryInsert({ ...base(30), doctorId: w.doctors[1] as string, startsAt: new Date(day.getTime() + 15 * MIN) });
    expect(e?.constraint).toBe('appointments_patient_no_overlap');
  });

  it('back-to-back visits for one patient are fine (patient needs no preparation time)', async () => {
    const day = new Date(NINE.getTime() + 13 * 86_400_000);
    await insertAppt(t.db, { ...base(31), doctorId: w.doctors[0] as string, startsAt: day });
    expect(await tryInsert({ ...base(31), doctorId: w.doctors[1] as string, startsAt: new Date(day.getTime() + 30 * MIN) })).toBeNull();
  });

  it('20 parallel bookings by one patient for 20 different doctors at one time: one wins', async () => {
    const day = new Date(NINE.getTime() + 14 * 86_400_000);
    const res = await Promise.all(
      Array.from({ length: 12 }, (_, i) => tryInsert({ ...base(32), doctorId: w.doctors[i % 6] as string, startsAt: new Date(day.getTime() + Math.floor(i / 6) * 1 * MIN * 0), minutes: 30, serviceId: w.consult30 })),
    );
    // 12 attempts, only the first one on any doctor for that patient can win
    expect(res.filter((r) => r === null)).toHaveLength(1);
  });

  it('once per doctor per clinic-local day, using the clinic time zone (not UTC)', async () => {
    // Warsaw clinic, June (UTC+2): 22:30Z = 00:30 next local day; 21:30Z = 23:30 same local day as 20:30Z.
    const wdoc = w.warsawDoctor;
    await insertAppt(t.db, { ...base(33), doctorId: wdoc, clinicId: w.warsaw, startsAt: T('2026-07-01T20:30:00Z') }); // 22:30 local Jul 1
    // 00:30 local Jul 2: different local day, same UTC day -> allowed
    expect(await tryInsert({ ...base(33), doctorId: wdoc, clinicId: w.warsaw, startsAt: T('2026-07-01T22:30:00Z') })).toBeNull();
    // 08:00 local Jul 2 -> same local day as 00:30 local Jul 2 even though UTC date differs from the previous one
    const e = await tryInsert({ ...base(33), doctorId: wdoc, clinicId: w.warsaw, startsAt: T('2026-07-02T06:00:00Z') });
    expect(e?.code).toBe(PG.UNIQUE_VIOLATION);
    expect(e?.constraint).toBe('appointments_patient_doctor_day_uq');
  });
});

describe('derived columns and sanity checks', () => {
  it('local_date and occupied_until are computed by the database, not trusted from the caller', async () => {
    const day = new Date(NINE.getTime() + 20 * 86_400_000);
    const id = await insertAppt(t.db, { ...base(34), startsAt: day });
    const r = await t.db.execute(sql`SELECT local_date::text AS d, occupied_until, ends_at FROM appointments WHERE id = ${id}::uuid`);
    const row = r.rows[0] as { d: string; occupied_until: Date; ends_at: Date };
    expect(row.d).toBe('2026-06-30');
    expect(new Date(row.occupied_until).getTime() - new Date(row.ends_at).getTime()).toBe(5 * MIN);
  });

  it('rejects starts that are not on the 15-minute grid, zero-length visits and negative prices', async () => {
    expect((await tryInsert({ ...base(35), startsAt: at(7 + 21 * 24 * 60) }))?.code).toBe(PG.CHECK_VIOLATION);
    const zero = await t.db
      .insert(schema.appointments)
      .values({ ...apptValues({ ...base(35), startsAt: at(22 * 24 * 60) }), endsAt: at(22 * 24 * 60) })
      .then(() => null, asPgError);
    expect(zero?.code).toBe(PG.CHECK_VIOLATION);
    const neg = await t.db
      .insert(schema.appointments)
      .values({ ...apptValues({ ...base(35), startsAt: at(23 * 24 * 60) }), priceMinor: -1 })
      .then(() => null, asPgError);
    expect(neg?.code).toBe(PG.CHECK_VIOLATION);
  });

  it('a hold without an expiry is impossible', async () => {
    const e = await tryInsert({ ...base(36), startsAt: at(24 * 24 * 60), status: 'held', holdExpiresAt: null });
    expect(e?.code).toBe(PG.CHECK_VIOLATION);
  });

  it('a doctor cannot be booked for a service he does not provide', async () => {
    await t.db.execute(sql`DELETE FROM doctor_services WHERE doctor_id = ${w.doctors[5]}::uuid AND service_id = ${w.quick15}::uuid`);
    const e = await tryInsert({ ...base(37), doctorId: w.doctors[5] as string, serviceId: w.quick15, minutes: 15, startsAt: at(25 * 24 * 60) });
    expect(e?.code).toBe(PG.SERVICE_NOT_PROVIDED);
  });

  it('services are 15..90 minutes in 15-minute steps; templates need a sane break', async () => {
    const bad = (minutes: number) =>
      t.db.insert(schema.services).values({ code: `bad${minutes}`, specialty: 'x', nameUk: 'x', nameEn: 'x', namePl: 'x', durationMin: minutes }).then(() => null, asPgError);
    for (const m of [0, 10, 14, 20, 100, 105, 120]) expect((await bad(m))?.code).toBe(PG.CHECK_VIOLATION);
    expect(await bad(90)).toBeNull();
    const badTpl = await t.db
      .insert(schema.scheduleTemplates)
      .values({ doctorId: w.doctors[0] as string, clinicId: w.kyiv, weekday: 1, startLocal: '09:00', endLocal: '17:00', breakStartLocal: '08:00', breakEndLocal: '09:00' })
      .then(() => null, asPgError);
    expect(badTpl?.code).toBe(PG.CHECK_VIOLATION);
    const dup = async () =>
      t.db.insert(schema.scheduleTemplates).values({ doctorId: w.doctors[0] as string, clinicId: w.kyiv, weekday: 2, startLocal: '09:00', endLocal: '17:00' }).then(() => null, asPgError);
    expect(await dup()).toBeNull();
    expect((await dup())?.code).toBe(PG.UNIQUE_VIOLATION); // one clinic per doctor per weekday
  });

  it('emails are unique case-insensitively; registrar needs a clinic; doctor needs a doctor', async () => {
    const mk = (email: string, role: 'patient' | 'registrar' | 'doctor') =>
      t.db.insert(schema.users).values({ email, passwordHash: 'x', role }).then(() => null, asPgError);
    expect(await mk('A@x.io', 'patient')).toBeNull();
    expect((await mk('a@X.io', 'patient'))?.code).toBe(PG.UNIQUE_VIOLATION);
    expect((await mk('r@x.io', 'registrar'))?.code).toBe(PG.CHECK_VIOLATION);
    expect((await mk('d@x.io', 'doctor'))?.code).toBe(PG.CHECK_VIOLATION);
  });
});
