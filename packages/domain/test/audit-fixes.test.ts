import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import {
  cancelAppointment, confirmBooking, getAvailability, holdSlot, joinWaitlist, markDoctorSick, registrarBook, type Actor, type Ctx,
} from '../src/index.js';
import { T0, at, codeOf, count, createTestDb, makeCtx, makeWorld, must, rows, workday, type Clock, type TestDb, type World } from './helpers.js';

let t: TestDb;
let w: World;
const clock: Clock = { now: T0 };
let ctx: Ctx;
let n = 0;
const k = (): string => `af-${++n}-${Math.random().toString(36).slice(2)}`;
const P = (i: number): Actor => (w.patients[i] as World['patients'][number]).actor;
const pid = (i: number): string => (w.patients[i] as World['patients'][number]).id;
const doc = (i: number): string => w.kyivDoctors[i] as string;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const jitter = (max = 15): Promise<void> => sleep(Math.random() * max);

beforeAll(async () => {
  t = await createTestDb();
  w = await makeWorld(t.db);
  ctx = makeCtx(t.db, clock);
});
afterAll(async () => {
  await t.drop();
});
beforeEach(async () => {
  clock.now = T0;
  await t.db.execute(sql`UPDATE waitlist_entries SET status = 'cancelled' WHERE status = 'active'`);
});

const req = (day: number, time: string, doctor: number, svc: 'c30' | 'q15' = 'c30') => ({
  clinicId: w.kyiv, doctorId: doc(doctor), serviceId: svc === 'c30' ? w.c30 : w.q15, startsAt: at(workday(day), time),
});
const book = async (actor: Actor, r: ReturnType<typeof req>) => {
  const h = must(await holdSlot(ctx, actor, r));
  return must(await confirmBooking(ctx, actor, { appointmentId: h.id, idempotencyKey: k() }));
};
const join = (who: number, doctor: number, day: number, span = 3) =>
  joinWaitlist(ctx, P(who), { doctorId: doc(doctor), serviceId: w.c30, fromDate: workday(day), toDate: workday(day + span) }).then((r) => must(r));
const pendingOffers = (doctorId: string, startsAt?: Date) =>
  count(t.db, sql`SELECT count(*)::int AS n FROM waitlist_offers o JOIN appointments a ON a.id = o.appointment_id
    WHERE o.status = 'pending' AND a.doctor_id = ${doctorId}::uuid AND a.status = 'held'
    ${startsAt ? sql`AND a.starts_at = ${startsAt.toISOString()}::timestamptz` : sql``}`);
const dayLockKey = (doctorId: string, date: string): string => `doctor-day:${doctorId}:${date}`;

describe('audit 1: sick day, cancel, hold and confirm never deadlock', () => {
  it('30 rounds of mixed concurrent flows on one doctor-day: only expected codes, nothing survives the sick mark', async () => {
    const unexpected: string[] = [];
    const record = (label: string, r: { ok: boolean; error?: { code: string } }, allowed: string[]): void => {
      const c = r.ok ? 'ok' : (r.error?.code ?? '?');
      if (!allowed.includes(c)) unexpected.push(`${label}:${c}`);
    };
    for (let round = 0; round < 30; round++) {
      const d = round % 6;
      const day = 20 + Math.floor(round / 6);
      const date = workday(day);
      await t.db.execute(sql`UPDATE waitlist_entries SET status = 'cancelled' WHERE status = 'active'`);
      const base = ['09:00', '09:30', '10:00', '10:30', '11:00'];
      const booked = [];
      for (const [i, tm] of base.entries()) booked.push(await book(P(i), req(day, tm, d, 'q15')));
      for (const who of [30, 31, 32, 33]) await join(who, d, day, 2);

      const ops: Promise<void>[] = [];
      for (const i of [0, 1, 2]) {
        ops.push((async () => { await jitter(); record('cancel', await cancelAppointment(ctx, P(i), { appointmentId: (booked[i] as { id: string }).id }), ['ok']); })());
      }
      for (const [j, tm] of (['14:00', '14:30', '15:00'] as const).entries()) {
        ops.push((async () => {
          await jitter();
          const h = await holdSlot(ctx, P(5 + j), req(day, tm, d, 'q15'));
          record('hold', h, ['ok', 'OUTSIDE_WORKING_HOURS']);
          if (!h.ok) return;
          await jitter();
          record('confirm', await confirmBooking(ctx, P(5 + j), { appointmentId: h.value.id, idempotencyKey: k() }), ['ok', 'OUTSIDE_WORKING_HOURS', 'INVALID_TRANSITION']);
        })());
      }
      ops.push((async () => {
        await jitter();
        const a = await holdSlot(ctx, P(8), req(day, '15:30', d, 'q15'));
        record('hold8a', a, ['ok', 'OUTSIDE_WORKING_HOURS']);
        await jitter();
        record('hold8b', await holdSlot(ctx, P(8), req(day, '16:00', d, 'q15')), ['ok', 'OUTSIDE_WORKING_HOURS']);
      })());
      for (let s = 0; s < 2; s++) {
        ops.push((async () => { await jitter(); record('sick', await markDoctorSick(ctx, w.registrar.kyiv, { doctorId: doc(d), localDate: date }), ['ok']); })());
      }
      await Promise.all(ops);
      // a sick mark that landed first may precede some of the others: the last word is a repeated mark
      record('sick-final', await markDoctorSick(ctx, w.registrar.kyiv, { doctorId: doc(d), localDate: date }), ['ok']);

      const alive = await count(t.db, sql`SELECT count(*)::int AS n FROM appointments WHERE doctor_id = ${doc(d)}::uuid AND local_date = ${date}::date AND status IN ('booked', 'held')`);
      const liveOffers = await count(t.db, sql`SELECT count(*)::int AS n FROM appointments a JOIN waitlist_offers o ON o.appointment_id = a.id
        WHERE a.doctor_id = ${doc(d)}::uuid AND a.local_date = ${date}::date AND a.kind = 'waitlist_offer' AND a.status = 'held'`);
      if (alive !== 0 || liveOffers !== 0) unexpected.push(`round ${round}: alive=${alive} liveOffers=${liveOffers}`);
    }
    expect(unexpected).toEqual([]);
  }, 300_000);
});

describe('audit 2: no offer is created on a day the doctor is sick', () => {
  it('a cancel that races a sick mark waits for it and then offers nothing (no offer, no email)', async () => {
    const day = 12;
    const date = workday(day);
    const a = await book(P(10), req(day, '10:00', 1));
    await join(34, 1, day);
    await join(35, 1, day);

    // a "sick mark" transaction in flight: it holds the doctor-day lock and has written the exception
    const raw = new pg.Client({ connectionString: t.url });
    await raw.connect();
    await raw.query('BEGIN');
    await raw.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [dayLockKey(doc(1), date)]);
    await raw.query(`INSERT INTO schedule_exceptions (doctor_id, local_date, kind) VALUES ($1, $2, 'sick')`, [doc(1), date]);

    let finished = false;
    const cancelling = cancelAppointment(ctx, P(10), { appointmentId: a.id }).then((r) => { finished = true; return r; });
    await sleep(400);
    const finishedEarly = finished;
    await raw.query('COMMIT');
    await raw.end();
    await cancelling;
    expect(finishedEarly).toBe(false); // the cancel must queue behind the doctor-day lock
    expect(codeOf(await cancelling)).toBe('ok');

    expect(await pendingOffers(doc(1))).toBe(0);
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM waitlist_offers o JOIN appointments x ON x.id = o.appointment_id WHERE x.doctor_id = ${doc(1)}::uuid AND x.local_date = ${date}::date`)).toBe(0);
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM scheduled_tasks WHERE kind = 'email.waitlist_offer' AND payload->>'appointmentId' IN (SELECT id::text FROM appointments WHERE doctor_id = ${doc(1)}::uuid AND local_date = ${date}::date)`)).toBe(0);
  });
});

describe('audit 3: a replaced hold goes to the waiting list', () => {
  it('second pick by the same patient: the first time is offered to the queue and hidden from the grid', async () => {
    const first = must(await holdSlot(ctx, P(11), req(4, '10:00', 2)));
    await join(12, 2, 4);
    must(await holdSlot(ctx, P(11), req(4, '11:00', 2)));
    expect(await pendingOffers(doc(2), first.startsAt)).toBe(1);
    const offered = await rows<{ patient_id: string }>(t.db, sql`SELECT a.patient_id FROM waitlist_offers o JOIN appointments a ON a.id = o.appointment_id WHERE o.status = 'pending' AND a.starts_at = ${first.startsAt.toISOString()}::timestamptz AND a.doctor_id = ${doc(2)}::uuid`);
    expect(offered.map((r) => r.patient_id)).toEqual([pid(12)]);
    const g = must(await getAvailability(ctx, { clinicId: w.kyiv, serviceId: w.c30, doctorId: doc(2), fromDate: workday(4), days: 1 }));
    expect(g.slots.some((s) => s.startsAt.getTime() === first.startsAt.getTime())).toBe(false);
  });

  it('picking the very same time again does not hand it to the queue', async () => {
    const first = must(await holdSlot(ctx, P(13), req(4, '14:00', 2)));
    await join(14, 2, 4);
    const again = must(await holdSlot(ctx, P(13), req(4, '14:00', 2)));
    expect(again.id).not.toBe(first.id);
    expect(await pendingOffers(doc(2), first.startsAt)).toBe(0);
  });
});

describe('audit 4: a hold is only replaced by a hold of the same channel', () => {
  it('registrar phone hold does not cancel the patient\'s online hold (confirm still works)', async () => {
    const online = must(await holdSlot(ctx, P(15), req(5, '10:00', 3)));
    must(await holdSlot(ctx, w.registrar.kyiv, { ...req(6, '11:00', 3), patientId: pid(15) }));
    const st = await rows<{ status: string }>(t.db, sql`SELECT status FROM appointments WHERE id = ${online.id}::uuid`);
    expect(st[0]?.status).toBe('held');
    must(await confirmBooking(ctx, P(15), { appointmentId: online.id, idempotencyKey: k() }));
  });

  it('patient online hold does not cancel a registrar hold, but replaces the earlier online one', async () => {
    const phone = must(await holdSlot(ctx, w.registrar.kyiv, { ...req(6, '12:00', 3), patientId: pid(16) }));
    const o1 = must(await holdSlot(ctx, P(16), req(5, '14:00', 3)));
    const o2 = must(await holdSlot(ctx, P(16), req(5, '14:30', 3)));
    const st = await rows<{ id: string; status: string }>(t.db, sql`SELECT id, status FROM appointments WHERE patient_id = ${pid(16)}::uuid`);
    const by = Object.fromEntries(st.map((r) => [r.id, r.status]));
    expect(by[phone.id]).toBe('held');
    expect(by[o1.id]).toBe('cancelled');
    expect(by[o2.id]).toBe('held');
  });

  it('parallel phone bookings for one patient up to the 3-visit limit all succeed', async () => {
    const results = await Promise.all([0, 1, 2, 3, 4].map((i) =>
      registrarBook(ctx, w.registrar.kyiv, { ...req(6 + i, '10:00', 4), patientId: pid(17), idempotencyKey: k() })));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results.filter((r) => !r.ok).map(codeOf).every((c) => c === 'FUTURE_LIMIT_REACHED')).toBe(true);
  });
});

describe('audit 5: registrarBook is idempotent', () => {
  it('replay with the same key returns the same visit (even at the daily limit)', async () => {
    const key = k();
    const input = { ...req(7, '10:00', 5), patientId: pid(18), idempotencyKey: key };
    const a = must(await registrarBook(ctx, w.registrar.kyiv, input));
    const b = must(await registrarBook(ctx, w.registrar.kyiv, input));
    expect(b.id).toBe(a.id);
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM appointments WHERE patient_id = ${pid(18)}::uuid AND status <> 'cancelled'`)).toBe(1);
  });

  it('10 concurrent identical calls make exactly one booking, all return its id', async () => {
    const input = { ...req(7, '11:00', 5), patientId: pid(19), idempotencyKey: k() };
    const rs = await Promise.all(Array.from({ length: 10 }, () => registrarBook(ctx, w.registrar.kyiv, input)));
    expect(rs.map(codeOf)).toEqual(Array(10).fill('ok'));
    const ids = new Set(rs.map((r) => (r.ok ? r.value.id : '')));
    expect(ids.size).toBe(1);
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM appointments WHERE patient_id = ${pid(19)}::uuid AND status <> 'cancelled'`)).toBe(1);
  });

  it('same key, different slot or patient: IDEMPOTENCY_KEY_REUSED', async () => {
    const key = k();
    must(await registrarBook(ctx, w.registrar.kyiv, { ...req(7, '12:00', 5), patientId: pid(20), idempotencyKey: key }));
    expect(codeOf(await registrarBook(ctx, w.registrar.kyiv, { ...req(7, '12:30', 5), patientId: pid(20), idempotencyKey: key }))).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(codeOf(await registrarBook(ctx, w.registrar.kyiv, { ...req(7, '12:00', 5), patientId: pid(21), idempotencyKey: key }))).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM appointments WHERE patient_id IN (${pid(20)}::uuid, ${pid(21)}::uuid) AND status <> 'cancelled'`)).toBe(1);
  });
});

describe('audit 6: one patient, one pending offer', () => {
  it('two entries (two doctors), two slots freed one after the other: one offer only', async () => {
    const a = await book(P(22), req(8, '10:00', 0));
    const b = await book(P(23), req(8, '12:00', 1));
    await join(24, 0, 8);
    await join(24, 1, 8);
    must(await cancelAppointment(ctx, P(22), { appointmentId: a.id }));
    must(await cancelAppointment(ctx, P(23), { appointmentId: b.id }));
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM waitlist_offers o JOIN waitlist_entries e ON e.id = o.entry_id WHERE e.patient_id = ${pid(24)}::uuid AND o.status = 'pending'`)).toBe(1);
  });

  it('two slots freed at the same moment (concurrent cancels): still one offer', async () => {
    for (let round = 0; round < 10; round++) {
      await t.db.execute(sql`UPDATE waitlist_entries SET status = 'cancelled' WHERE status = 'active'`);
      const day = 25 + round;
      const a = await book(P(25), req(day, '10:00', 0));
      const b = await book(P(26), req(day, '12:00', 1));
      await join(27, 0, day, 0);
      await join(27, 1, day, 0);
      await Promise.all([
        cancelAppointment(ctx, P(25), { appointmentId: a.id }).then((r) => must(r)),
        cancelAppointment(ctx, P(26), { appointmentId: b.id }).then((r) => must(r)),
      ]);
      expect(await count(t.db, sql`SELECT count(*)::int AS n FROM waitlist_offers o JOIN waitlist_entries e ON e.id = o.entry_id WHERE e.patient_id = ${pid(27)}::uuid AND o.status = 'pending'`)).toBe(1);
      await t.db.execute(sql`UPDATE waitlist_offers SET status = 'declined' WHERE status = 'pending'`);
      await t.db.execute(sql`UPDATE appointments SET status = 'cancelled' WHERE status = 'held' AND kind = 'waitlist_offer'`);
    }
  });
});
