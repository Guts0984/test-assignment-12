import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  cancelAppointment,
  confirmBooking,
  getAvailability,
  holdSlot,
  registrarBook,
  type Actor,
  type Ctx,
} from '../src/index.js';
import {
  DAY,
  HOUR,
  MIN,
  T0,
  at,
  codeOf,
  count,
  createTestDb,
  makeCtx,
  makeWorld,
  must,
  rows,
  workday,
  type Clock,
  type TestDb,
  type World,
} from './helpers.js';

let t: TestDb;
let w: World;
const clock: Clock = { now: T0 };
let ctx: Ctx;
let key = 0;
const k = (): string => `key-${++key}-${Math.random().toString(36).slice(2)}`;

beforeAll(async () => {
  t = await createTestDb();
  w = await makeWorld(t.db);
  ctx = makeCtx(t.db, clock);
});
afterAll(async () => {
  await t.drop();
});

const req = (day: number, time: string, doctor = 0, svc = 'c30') => ({
  clinicId: w.kyiv,
  doctorId: w.kyivDoctors[doctor] as string,
  serviceId: svc === 'c30' ? w.c30 : svc === 'q15' ? w.q15 : w.u30,
  startsAt: at(workday(day), time),
});
const P = (i: number): Actor => (w.patients[i] as World['patients'][number]).actor;

const book = async (actor: Actor, r: ReturnType<typeof req>) => {
  const h = must(await holdSlot(ctx, actor, r), 'hold');
  return must(
    await confirmBooking(ctx, actor, { appointmentId: h.id, idempotencyKey: k() }),
    'confirm',
  );
};

describe('hold', () => {
  it('reserves the time for 10 minutes and queues the expiry task', async () => {
    const h = must(await holdSlot(ctx, P(0), req(0, '09:00')));
    expect(h.status).toBe('held');
    expect(h.holdExpiresAt?.getTime()).toBe(T0.getTime() + 10 * MIN);
    expect(h.priceMinor).toBe(70_000);
    expect(h.currency).toBe('UAH');
    const tasks = await rows<{ run_at: string }>(
      t.db,
      sql`SELECT run_at FROM scheduled_tasks WHERE kind = 'hold.expire' AND payload->>'appointmentId' = ${h.id}`,
    );
    expect(tasks).toHaveLength(1);
    expect(new Date(tasks[0]?.run_at as string).getTime()).toBe(h.holdExpiresAt?.getTime());
    const ev = await rows<{ actor_role: string; type: string }>(
      t.db,
      sql`SELECT actor_role, type FROM appointment_events WHERE appointment_id = ${h.id}::uuid`,
    );
    expect(ev).toEqual([{ actor_role: 'patient', type: 'held' }]);
  });

  it('a held slot vanishes from the grid for others, and comes back when the hold is released', async () => {
    const r = req(1, '10:00', 1);
    const h = must(await holdSlot(ctx, P(1), r));
    const grid = must(
      await getAvailability(ctx, {
        clinicId: w.kyiv,
        serviceId: w.c30,
        doctorId: r.doctorId,
        fromDate: workday(1),
      }),
    );
    expect(grid.slots.some((s) => s.startsAt.getTime() === r.startsAt.getTime())).toBe(false);
    must(await cancelAppointment(ctx, P(1), { appointmentId: h.id }));
    const grid2 = must(
      await getAvailability(ctx, {
        clinicId: w.kyiv,
        serviceId: w.c30,
        doctorId: r.doctorId,
        fromDate: workday(1),
      }),
    );
    expect(grid2.slots.some((s) => s.startsAt.getTime() === r.startsAt.getTime())).toBe(true);
  });

  it('booking window: not before 2 hours, not after 60 days', async () => {
    const day = workday(0);
    const soon = { ...req(0, '10:00', 2), startsAt: at(day, '10:00') };
    const savedNow = clock.now;
    clock.now = new Date(soon.startsAt.getTime() - 120 * MIN + MIN); // 119 min before
    expect(codeOf(await holdSlot(ctx, P(2), soon))).toBe('OUTSIDE_BOOKING_WINDOW');
    clock.now = new Date(soon.startsAt.getTime() - 120 * MIN); // exactly 120
    expect(codeOf(await holdSlot(ctx, P(2), soon))).toBe('ok');
    clock.now = savedNow;
    const far = { ...req(0, '10:00', 3), startsAt: at('2026-08-05', '10:00') }; // > 60 days after 2026-06-01
    expect(codeOf(await holdSlot(ctx, P(3), far))).toBe('OUTSIDE_BOOKING_WINDOW');
  });

  it('refuses times the doctor does not work: break, after hours, off-grid, weekend, wrong clinic', async () => {
    for (const time of ['13:00', '13:15', '16:45', '08:45', '09:10', '17:00'])
      expect(codeOf(await holdSlot(ctx, P(4), req(2, time))), time).toBe('OUTSIDE_WORKING_HOURS');
    expect(
      codeOf(
        await holdSlot(ctx, P(4), { ...req(2, '10:00'), startsAt: at('2026-06-13', '10:00') }),
      ),
      'saturday',
    ).toBe('OUTSIDE_WORKING_HOURS');
    expect(
      codeOf(await holdSlot(ctx, P(4), { ...req(2, '10:00'), doctorId: w.warsawDoctor })),
      'doctor of another clinic',
    ).toBe('SERVICE_NOT_PROVIDED');
  });

  it('20 patients race for one time: exactly one reservation, nineteen clear refusals, no crash', async () => {
    const r = req(3, '10:00', 4);
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => holdSlot(ctx, P(10 + i), r)),
    );
    expect(results.every((x) => x.status === 'fulfilled')).toBe(true);
    const codes = results.map((x) => (x.status === 'fulfilled' ? codeOf(x.value) : 'THROWN'));
    expect(codes.filter((c) => c === 'ok')).toHaveLength(1);
    expect(codes.filter((c) => c === 'SLOT_TAKEN')).toHaveLength(19);
    expect(
      await count(
        t.db,
        sql`SELECT count(*)::int AS n FROM appointments WHERE doctor_id = ${r.doctorId}::uuid AND starts_at = ${r.startsAt.toISOString()}::timestamptz AND status <> 'cancelled'`,
      ),
    ).toBe(1);
  });

  it('the same race through the registrar desk behaves the same', async () => {
    const r = req(4, '10:00', 4);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        registrarBook(ctx, w.registrar.kyiv, {
          ...r,
          patientId: (w.patients[i] as World['patients'][number]).id,
          idempotencyKey: k(),
        }),
      ),
    );
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    expect(results.filter((x) => !x.ok).every((x) => !x.ok && x.error.code === 'SLOT_TAKEN')).toBe(
      true,
    );
  });

  it('two doctors, one ultrasound room, same time: only one reservation (invariant 2)', async () => {
    const results = await Promise.all(
      [0, 1, 2, 3].map((d) => holdSlot(ctx, P(d), req(5, '11:00', d, 'u30'))),
    );
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    for (const x of results)
      if (!x.ok) expect(['ROOM_TAKEN', 'SLOT_TAKEN']).toContain(x.error.code);
  });

  it('only one live hold per patient: a new hold releases the previous one', async () => {
    const a = must(await holdSlot(ctx, P(5), req(6, '09:00', 0)));
    const b = must(await holdSlot(ctx, P(5), req(6, '09:30', 1)));
    const states = await rows<{ id: string; status: string }>(
      t.db,
      sql`SELECT id, status FROM appointments WHERE id IN (${a.id}::uuid, ${b.id}::uuid)`,
    );
    expect(states.find((s) => s.id === a.id)?.status).toBe('cancelled');
    expect(states.find((s) => s.id === b.id)?.status).toBe('held');
    // and a failed new hold keeps the old one (the replacement is part of the same transaction)
    must(await holdSlot(ctx, P(6), req(6, '10:00', 2)));
    expect(codeOf(await holdSlot(ctx, P(5), req(6, '10:00', 2)))).toBe('SLOT_TAKEN');
    expect(
      await count(
        t.db,
        sql`SELECT count(*)::int AS n FROM appointments WHERE id = ${b.id}::uuid AND status = 'held'`,
      ),
    ).toBe(1);
  });

  it('a patient cannot be in two places: overlapping confirmed visit with another doctor', async () => {
    await book(P(7), req(7, '10:00', 0));
    expect(codeOf(await holdSlot(ctx, P(7), req(7, '10:15', 1)))).toBe('PATIENT_BUSY');
  });

  it('one visit per doctor per day', async () => {
    await book(P(8), req(8, '10:00', 0));
    expect(codeOf(await holdSlot(ctx, P(8), req(8, '15:00', 0)))).toBe('DOCTOR_DAILY_LIMIT');
    expect(codeOf(await holdSlot(ctx, P(8), req(8, '15:00', 1)))).toBe('ok');
  });
});

describe('at most 3 upcoming visits (invariant 3)', () => {
  it('the 4th is refused', async () => {
    for (const d of [10, 11, 12]) await book(P(20), req(d, '09:00', 0));
    expect(codeOf(await holdSlot(ctx, P(20), req(13, '09:00', 0)))).toBe('FUTURE_LIMIT_REACHED');
  });

  it('past visits and cancelled ones do not count', async () => {
    const a = await book(P(21), req(10, '09:00', 1));
    await book(P(21), req(11, '09:00', 1));
    await book(P(21), req(12, '09:00', 1));
    expect(codeOf(await holdSlot(ctx, P(21), req(13, '09:00', 1)))).toBe('FUTURE_LIMIT_REACHED');
    must(await cancelAppointment(ctx, P(21), { appointmentId: a.id }));
    expect(codeOf(await holdSlot(ctx, P(21), req(13, '09:00', 1)))).toBe('ok');
  });

  it('parallel hold+confirm flows by one patient cannot exceed 3', async () => {
    for (const d of [14, 15]) await book(P(22), req(d, '09:00', 1));
    const flows = await Promise.all(
      Array.from({ length: 8 }, async (_, i) => {
        const h = await holdSlot(ctx, P(22), req(16 + i, '09:00', 1));
        if (!h.ok) return codeOf(h);
        return codeOf(
          await confirmBooking(ctx, P(22), { appointmentId: h.value.id, idempotencyKey: k() }),
        );
      }),
    );
    expect(
      flows.every((c) =>
        ['ok', 'FUTURE_LIMIT_REACHED', 'NOT_FOUND', 'INVALID_TRANSITION'].includes(c),
      ),
      flows.join(),
    ).toBe(true);
    const live = await count(
      t.db,
      sql`SELECT count(*)::int AS n FROM appointments WHERE patient_id = ${(w.patients[22] as World['patients'][number]).id}::uuid AND status = 'booked'`,
    );
    expect(live).toBeLessThanOrEqual(3);
    expect(live).toBeGreaterThanOrEqual(3);
  });

  it('parallel confirms of many holds placed earlier cannot exceed 3 either', async () => {
    // holds are one-per-patient for patients, but the registrar can hold many; the cap still holds at confirm
    const pid = (w.patients[23] as World['patients'][number]).id;
    const holds = [];
    for (let i = 0; i < 3; i++) {
      holds.push(
        must(await holdSlot(ctx, w.registrar.kyiv, { ...req(20 + i, '09:00', 2), patientId: pid })),
      );
    }
    const outcomes = await Promise.all(
      holds.map((h) =>
        confirmBooking(ctx, w.registrar.kyiv, { appointmentId: h.id, idempotencyKey: k() }),
      ),
    );
    expect(outcomes.filter((o) => o.ok).length).toBeGreaterThanOrEqual(1);
    const live = await count(
      t.db,
      sql`SELECT count(*)::int AS n FROM appointments WHERE patient_id = ${pid}::uuid AND status IN ('booked','held') AND starts_at > ${T0.toISOString()}::timestamptz`,
    );
    expect(live).toBeLessThanOrEqual(3);
  });
});

describe('the hold lasts 10 minutes (invariant 4)', () => {
  it('confirm 1 ms before expiry works, exactly at expiry and later is refused', async () => {
    const h1 = must(await holdSlot(ctx, P(24), req(25, '09:00', 3)));
    clock.now = new Date(T0.getTime() + 10 * MIN - 1);
    expect(
      codeOf(await confirmBooking(ctx, P(24), { appointmentId: h1.id, idempotencyKey: k() })),
    ).toBe('ok');
    clock.now = T0;
    const h2 = must(await holdSlot(ctx, P(25), req(25, '10:00', 3)));
    clock.now = new Date(T0.getTime() + 10 * MIN);
    expect(
      codeOf(await confirmBooking(ctx, P(25), { appointmentId: h2.id, idempotencyKey: k() })),
    ).toBe('HOLD_EXPIRED');
    clock.now = new Date(T0.getTime() + 10 * MIN + 60_000 + 1000); // 10:01
    expect(
      codeOf(await confirmBooking(ctx, P(25), { appointmentId: h2.id, idempotencyKey: k() })),
    ).toBe('HOLD_EXPIRED');
    clock.now = T0;
  });

  it('an unconfirmed hold frees the time without any worker: it is visible in the grid and bookable by someone else', async () => {
    const r = req(26, '10:00', 3);
    must(await holdSlot(ctx, P(26), r));
    clock.now = new Date(T0.getTime() + 10 * MIN + 1000);
    const grid = must(
      await getAvailability(ctx, {
        clinicId: w.kyiv,
        serviceId: w.c30,
        doctorId: r.doctorId,
        fromDate: workday(26),
      }),
    );
    expect(grid.slots.some((s) => s.startsAt.getTime() === r.startsAt.getTime())).toBe(true);
    const other = must(await holdSlot(ctx, P(27), r)); // lazy sweep releases the stale hold
    expect(other.status).toBe('held');
    clock.now = T0;
  });

  it("someone else's confirm that arrives late cannot overwrite the new holder (no booking on top of a fresh hold)", async () => {
    const r = req(27, '10:00', 3);
    const first = must(await holdSlot(ctx, P(28), r));
    clock.now = new Date(T0.getTime() + 11 * MIN);
    const second = must(await holdSlot(ctx, P(29), r));
    expect(
      codeOf(await confirmBooking(ctx, P(28), { appointmentId: first.id, idempotencyKey: k() })),
    ).toBe('HOLD_EXPIRED');
    expect(
      codeOf(await confirmBooking(ctx, P(29), { appointmentId: second.id, idempotencyKey: k() })),
    ).toBe('ok');
    clock.now = T0;
  });

  it('the expire job is idempotent and does nothing early', async () => {
    const { expireHold } = await import('../src/index.js');
    const h = must(await holdSlot(ctx, P(30), req(28, '10:00', 3)));
    expect(must(await expireHold(ctx, h.id)).released).toBe(false); // too early
    clock.now = new Date(T0.getTime() + 10 * MIN);
    expect(must(await expireHold(ctx, h.id)).released).toBe(true);
    expect(must(await expireHold(ctx, h.id)).released).toBe(false);
    clock.now = T0;
    const confirmed = await book(P(31), req(29, '10:00', 3));
    clock.now = new Date(T0.getTime() + 20 * MIN);
    expect(must(await expireHold(ctx, confirmed.id)).released).toBe(false); // never touches a booking
    clock.now = T0;
  });
});

describe('confirmation is idempotent (invariant 6)', () => {
  it('a replay with the same key returns the same visit and creates no duplicates', async () => {
    const h = must(await holdSlot(ctx, P(32), req(30, '10:00', 3)));
    const key1 = k();
    const a = must(await confirmBooking(ctx, P(32), { appointmentId: h.id, idempotencyKey: key1 }));
    const b = must(await confirmBooking(ctx, P(32), { appointmentId: h.id, idempotencyKey: key1 }));
    expect(b.id).toBe(a.id);
    expect(
      await count(
        t.db,
        sql`SELECT count(*)::int AS n FROM scheduled_tasks WHERE payload->>'appointmentId' = ${a.id} AND kind LIKE 'reminder.%'`,
      ),
    ).toBe(2);
    expect(
      await count(
        t.db,
        sql`SELECT count(*)::int AS n FROM scheduled_tasks WHERE payload->>'appointmentId' = ${a.id} AND kind = 'email.booking_confirmed'`,
      ),
    ).toBe(1);
    expect(
      await count(
        t.db,
        sql`SELECT count(*)::int AS n FROM appointment_events WHERE appointment_id = ${a.id}::uuid AND type = 'confirmed'`,
      ),
    ).toBe(1);
    // a different key on the already confirmed visit is not a second confirmation
    expect(
      codeOf(await confirmBooking(ctx, P(32), { appointmentId: h.id, idempotencyKey: k() })),
    ).toBe('INVALID_TRANSITION');
  });

  it('15 simultaneous retries with one key: one booking, everyone gets it', async () => {
    const h = must(await holdSlot(ctx, P(33), req(31, '10:00', 3)));
    const key1 = k();
    const res = await Promise.all(
      Array.from({ length: 15 }, () =>
        confirmBooking(ctx, P(33), { appointmentId: h.id, idempotencyKey: key1 }),
      ),
    );
    expect(res.every((r) => r.ok)).toBe(true);
    expect(new Set(res.map((r) => (r.ok ? r.value.id : ''))).size).toBe(1);
    expect(
      await count(
        t.db,
        sql`SELECT count(*)::int AS n FROM scheduled_tasks WHERE payload->>'appointmentId' = ${h.id} AND kind = 'reminder.2h'`,
      ),
    ).toBe(1);
  });

  it('the same key for a different hold is rejected; keys are scoped per user', async () => {
    const h1 = must(await holdSlot(ctx, P(34), req(32, '10:00', 3)));
    const key1 = k();
    must(await confirmBooking(ctx, P(34), { appointmentId: h1.id, idempotencyKey: key1 }));
    const h2 = must(await holdSlot(ctx, P(34), req(33, '10:00', 3)));
    expect(
      codeOf(await confirmBooking(ctx, P(34), { appointmentId: h2.id, idempotencyKey: key1 })),
    ).toBe('IDEMPOTENCY_KEY_REUSED');
    // another user may use the same key string for their own hold
    const h3 = must(await holdSlot(ctx, P(35), req(34, '10:00', 3)));
    expect(
      codeOf(await confirmBooking(ctx, P(35), { appointmentId: h3.id, idempotencyKey: key1 })),
    ).toBe('ok');
  });

  it('a failed confirm does not burn the key', async () => {
    const h = must(await holdSlot(ctx, P(36), req(35, '10:00', 3)));
    clock.now = new Date(T0.getTime() + 11 * MIN);
    const key1 = k();
    expect(
      codeOf(await confirmBooking(ctx, P(36), { appointmentId: h.id, idempotencyKey: key1 })),
    ).toBe('HOLD_EXPIRED');
    const h2 = must(await holdSlot(ctx, P(36), req(35, '10:00', 3)));
    expect(
      codeOf(await confirmBooking(ctx, P(36), { appointmentId: h2.id, idempotencyKey: key1 })),
    ).toBe('ok');
    clock.now = T0;
  });

  it('someone else cannot replay your key to read your booking', async () => {
    const h = must(await holdSlot(ctx, P(37), req(36, '10:00', 3)));
    const key1 = k();
    must(await confirmBooking(ctx, P(37), { appointmentId: h.id, idempotencyKey: key1 }));
    expect(
      codeOf(await confirmBooking(ctx, P(38), { appointmentId: h.id, idempotencyKey: key1 })),
    ).toBe('NOT_FOUND');
  });
});

describe('reminders are scheduled on confirm (invariant 8, part 1)', () => {
  it('24h and 2h before the visit, in the clinic wall clock', async () => {
    const a = must(
      await confirmBooking(ctx, P(0), {
        appointmentId: must(await holdSlot(ctx, P(0), req(9, '10:00', 5))).id,
        idempotencyKey: k(),
      }),
    );
    const tasks = await rows<{ kind: string; run_at: string; dedupe_key: string }>(
      t.db,
      sql`SELECT kind, run_at, dedupe_key FROM scheduled_tasks WHERE payload->>'appointmentId' = ${a.id} AND kind LIKE 'reminder.%' ORDER BY kind`,
    );
    expect(tasks.map((x) => x.kind)).toEqual(['reminder.24h', 'reminder.2h']);
    const by = Object.fromEntries(tasks.map((x) => [x.kind, new Date(x.run_at).getTime()]));
    expect(by['reminder.2h']).toBe(a.startsAt.getTime() - 2 * HOUR);
    expect(by['reminder.24h']).toBe(a.startsAt.getTime() - 24 * HOUR);
    expect(tasks[0]?.dedupe_key).toBe(`reminder.24h:${a.id}:v1`);
  });

  it('a visit booked less than 24h ahead gets only the 2h reminder', async () => {
    clock.now = new Date(at(workday(10), '10:00').getTime() - 5 * HOUR);
    const a = must(
      await confirmBooking(ctx, P(1), {
        appointmentId: must(await holdSlot(ctx, P(1), req(10, '10:00', 5))).id,
        idempotencyKey: k(),
      }),
    );
    const kinds = await rows<{ kind: string }>(
      t.db,
      sql`SELECT kind FROM scheduled_tasks WHERE payload->>'appointmentId' = ${a.id} AND kind LIKE 'reminder.%'`,
    );
    expect(kinds.map((x) => x.kind)).toEqual(['reminder.2h']);
    clock.now = T0;
  });

  it('24h reminder for a Warsaw visit the day after the clocks go back keeps the wall-clock time', async () => {
    // Sun 2026-10-25 10:00 Warsaw is UTC+1; the previous day's 10:00 was UTC+2 => 25 real hours earlier
    clock.now = new Date('2026-10-20T08:00:00Z');
    const wctx = makeCtx(t.db, clock, { maxAdvanceDays: 400 });
    const start = at('2026-10-26', '10:00', 'Europe/Warsaw'); // Monday after the change
    const h = must(
      await holdSlot(wctx, P(2), {
        clinicId: w.warsaw,
        doctorId: w.warsawDoctor,
        serviceId: w.c30,
        startsAt: start,
      }),
    );
    const a = must(await confirmBooking(wctx, P(2), { appointmentId: h.id, idempotencyKey: k() }));
    expect(a.currency).toBe('PLN');
    expect(a.priceMinor).toBe(25_000);
    const r = await rows<{ run_at: string }>(
      t.db,
      sql`SELECT run_at FROM scheduled_tasks WHERE payload->>'appointmentId' = ${a.id} AND kind = 'reminder.24h'`,
    );
    expect(new Date(r[0]?.run_at as string).toISOString()).toBe(
      at('2026-10-25', '10:00', 'Europe/Warsaw').toISOString(),
    );
    clock.now = T0;
  });
});

describe('registrar desk', () => {
  it('books by phone through the same rules; the online block does not apply to the registrar', async () => {
    const pid = (w.patients[3] as World['patients'][number]).id;
    await t.db.execute(
      sql`UPDATE patients SET online_booking_blocked_until = ${new Date(T0.getTime() + 20 * DAY).toISOString()}::timestamptz WHERE id = ${pid}::uuid`,
    );
    expect(codeOf(await holdSlot(ctx, P(3), req(11, '10:00', 5)))).toBe('ONLINE_BOOKING_BLOCKED');
    const a = must(
      await registrarBook(ctx, w.registrar.kyiv, {
        ...req(11, '10:00', 5),
        patientId: pid,
        idempotencyKey: k(),
      }),
    );
    expect(a.status).toBe('booked');
    // the registrar still obeys the booking window and the working hours
    expect(
      codeOf(
        await registrarBook(ctx, w.registrar.kyiv, {
          ...req(11, '13:00', 5),
          patientId: pid,
          idempotencyKey: k(),
        }),
      ),
    ).toBe('OUTSIDE_WORKING_HOURS');
    const ev = await rows<{ actor_role: string }>(
      t.db,
      sql`SELECT actor_role FROM appointment_events WHERE appointment_id = ${a.id}::uuid ORDER BY at, type`,
    );
    expect(ev.every((e) => e.actor_role === 'registrar')).toBe(true);
    // once the block is over the patient books online again
    clock.now = new Date(T0.getTime() + 21 * DAY);
    expect(codeOf(await holdSlot(makeCtx(t.db, clock), P(3), req(30, '10:00', 5)))).toBe('ok');
    clock.now = T0;
  });

  it('a registrar cannot book into another clinic', async () => {
    expect(
      codeOf(
        await holdSlot(ctx, w.registrar.warsaw, {
          ...req(12, '10:00', 5),
          patientId: (w.patients[4] as World['patients'][number]).id,
        }),
      ),
    ).toBe('NOT_FOUND');
  });
  it('a patient cannot book for someone else (patientId is ignored for patients)', async () => {
    const victim = (w.patients[5] as World['patients'][number]).id;
    const h = must(
      await holdSlot(ctx, P(4), { ...req(12, '11:00', 5), patientId: victim } as never),
    );
    expect(h.patientId).toBe((w.patients[4] as World['patients'][number]).id);
  });
  it('doctors, managers and anonymous cannot book', async () => {
    expect(codeOf(await holdSlot(ctx, w.doctorActor(0), req(12, '12:00', 5)))).toBe('FORBIDDEN');
    expect(
      codeOf(await holdSlot(ctx, { userId: null, role: 'manager' }, req(12, '12:00', 5))),
    ).toBe('FORBIDDEN');
    expect(
      codeOf(
        await holdSlot(
          ctx,
          { userId: null, role: 'patient', patientId: null },
          req(12, '12:00', 5),
        ),
      ),
    ).toBe('FORBIDDEN');
  });
});
