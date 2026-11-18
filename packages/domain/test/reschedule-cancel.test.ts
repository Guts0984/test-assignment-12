import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  cancelAppointment,
  confirmBooking,
  getAvailability,
  holdSlot,
  rescheduleAppointment,
  markNoShow,
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
let n = 0;
const k = (): string => `rk-${++n}-${Math.random().toString(36).slice(2)}`;
const P = (i: number): Actor => (w.patients[i] as World['patients'][number]).actor;
const pid = (i: number): string => (w.patients[i] as World['patients'][number]).id;

beforeAll(async () => {
  t = await createTestDb();
  w = await makeWorld(t.db);
  ctx = makeCtx(t.db, clock);
});
afterAll(async () => {
  await t.drop();
});
beforeEach(() => {
  clock.now = T0;
});

const r = (day: number, time: string, doctor = 0, svc: 'c30' | 'q15' | 'u30' = 'c30') => ({
  clinicId: w.kyiv,
  doctorId: w.kyivDoctors[doctor] as string,
  serviceId: svc === 'c30' ? w.c30 : svc === 'q15' ? w.q15 : w.u30,
  startsAt: at(workday(day), time),
});
let cur: Ctx | null = null; // some tests need a long booking window
const book = async (actor: Actor, req: ReturnType<typeof r>) => {
  const c = cur ?? ctx;
  const h = must(await holdSlot(c, actor, req), 'hold');
  return must(
    await confirmBooking(c, actor, { appointmentId: h.id, idempotencyKey: k() }),
    'confirm',
  );
};
const pendingReminders = (id: string) =>
  rows<{ kind: string; dedupe_key: string; run_at: string }>(
    t.db,
    sql`SELECT kind, dedupe_key, run_at FROM scheduled_tasks WHERE status = 'pending' AND kind LIKE 'reminder.%' AND payload->>'appointmentId' = ${id} ORDER BY kind`,
  );

describe('reschedule is atomic (invariant 5)', () => {
  it('moves the visit, bumps the version, records history and re-times the reminders (invariant 8)', async () => {
    const a = await book(P(0), r(3, '10:00', 0));
    const before = await pendingReminders(a.id);
    expect(before.map((x) => x.dedupe_key)).toEqual([
      `reminder.24h:${a.id}:v1`,
      `reminder.2h:${a.id}:v1`,
    ]);
    const target = at(workday(4), '11:00');
    const moved = must(
      await rescheduleAppointment(ctx, P(0), { appointmentId: a.id, newStartsAt: target }),
    );
    expect(moved.startsAt.getTime()).toBe(target.getTime());
    expect(moved.endsAt.getTime()).toBe(target.getTime() + 30 * MIN);
    expect(moved.version).toBe(2);
    expect(moved.status).toBe('booked');
    const after = await pendingReminders(a.id);
    expect(after.map((x) => x.dedupe_key)).toEqual([
      `reminder.24h:${a.id}:v2`,
      `reminder.2h:${a.id}:v2`,
    ]);
    expect(new Date(after[1]?.run_at as string).getTime()).toBe(target.getTime() - 2 * HOUR);
    expect(
      await count(
        t.db,
        sql`SELECT count(*)::int AS n FROM scheduled_tasks WHERE status = 'cancelled' AND kind LIKE 'reminder.%' AND payload->>'appointmentId' = ${a.id} AND payload->>'version' = '1'`,
      ),
    ).toBe(2);
    const ev = await rows<{ old_starts_at: string; new_starts_at: string; actor_role: string }>(
      t.db,
      sql`SELECT old_starts_at, new_starts_at, actor_role FROM appointment_events WHERE appointment_id = ${a.id}::uuid AND type = 'rescheduled'`,
    );
    expect(ev).toHaveLength(1);
    expect(new Date(ev[0]?.old_starts_at as string).getTime()).toBe(a.startsAt.getTime());
    expect(ev[0]?.actor_role).toBe('patient');
  });

  it('the vacated time returns to the grid and the new time leaves it', async () => {
    const a = await book(P(1), r(5, '10:00', 1));
    const target = at(workday(6), '10:00');
    must(await rescheduleAppointment(ctx, P(1), { appointmentId: a.id, newStartsAt: target }));
    const day5 = must(
      await getAvailability(ctx, {
        clinicId: w.kyiv,
        serviceId: w.c30,
        doctorId: a.doctorId,
        fromDate: workday(5),
        days: 1,
      }),
    );
    expect(day5.slots.some((s) => s.startsAt.getTime() === a.startsAt.getTime())).toBe(true);
    const day6 = must(
      await getAvailability(ctx, {
        clinicId: w.kyiv,
        serviceId: w.c30,
        doctorId: a.doctorId,
        fromDate: workday(6),
        days: 1,
      }),
    );
    expect(day6.slots.some((s) => s.startsAt.getTime() === target.getTime())).toBe(false);
  });

  it('into a time someone else holds: refused, and the old visit is exactly as it was', async () => {
    const mine = await book(P(2), r(7, '10:00', 2));
    await book(P(3), r(8, '10:00', 2));
    const err = await rescheduleAppointment(ctx, P(2), {
      appointmentId: mine.id,
      newStartsAt: at(workday(8), '10:00'),
    });
    expect(codeOf(err)).toBe('SLOT_TAKEN');
    const row = (
      await rows<{ starts_at: string; version: number; status: string }>(
        t.db,
        sql`SELECT starts_at, version, status FROM appointments WHERE id = ${mine.id}::uuid`,
      )
    )[0];
    expect(new Date(row?.starts_at as string).getTime()).toBe(mine.startsAt.getTime());
    expect(row?.version).toBe(1);
    expect((await pendingReminders(mine.id)).map((x) => x.dedupe_key)).toEqual([
      `reminder.24h:${mine.id}:v1`,
      `reminder.2h:${mine.id}:v1`,
    ]);
    expect(
      await count(
        t.db,
        sql`SELECT count(*)::int AS n FROM appointment_events WHERE appointment_id = ${mine.id}::uuid AND type = 'rescheduled'`,
      ),
    ).toBe(0);
  });

  it('two patients move into the same free time at once: one wins, the loser keeps the old visit', async () => {
    const a = await book(P(4), r(9, '10:00', 3));
    const b = await book(P(5), r(10, '10:00', 3));
    const target = at(workday(11), '10:00');
    const [ra, rb] = await Promise.all([
      rescheduleAppointment(ctx, P(4), { appointmentId: a.id, newStartsAt: target }),
      rescheduleAppointment(ctx, P(5), { appointmentId: b.id, newStartsAt: target }),
    ]);
    expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1);
    const loser = ra.ok ? b : a;
    const row = (
      await rows<{ starts_at: string; status: string }>(
        t.db,
        sql`SELECT starts_at, status FROM appointments WHERE id = ${loser.id}::uuid`,
      )
    )[0];
    expect(new Date(row?.starts_at as string).getTime()).toBe(loser.startsAt.getTime());
    expect(row?.status).toBe('booked');
    expect(
      await count(
        t.db,
        sql`SELECT count(*)::int AS n FROM appointments WHERE doctor_id = ${a.doctorId}::uuid AND starts_at = ${target.toISOString()}::timestamptz AND status <> 'cancelled'`,
      ),
    ).toBe(1);
  });

  it('rejects a time that breaks the rules, the same time, a wrong version, and visits that are not confirmed', async () => {
    const a = await book(P(6), r(12, '10:00', 4));
    expect(
      codeOf(
        await rescheduleAppointment(ctx, P(6), {
          appointmentId: a.id,
          newStartsAt: at(workday(12), '13:00'),
        }),
      ),
    ).toBe('OUTSIDE_WORKING_HOURS');
    expect(
      codeOf(
        await rescheduleAppointment(ctx, P(6), {
          appointmentId: a.id,
          newStartsAt: at(workday(12), '10:10'),
        }),
      ),
    ).toBe('OUTSIDE_WORKING_HOURS');
    expect(
      codeOf(
        await rescheduleAppointment(ctx, P(6), { appointmentId: a.id, newStartsAt: a.startsAt }),
      ),
    ).toBe('BAD_USER_INPUT');
    expect(
      codeOf(
        await rescheduleAppointment(ctx, P(6), {
          appointmentId: a.id,
          newStartsAt: at(workday(13), '10:00'),
          expectedVersion: 7,
        }),
      ),
    ).toBe('VERSION_CONFLICT');
    expect(
      codeOf(
        await rescheduleAppointment(ctx, P(6), {
          appointmentId: a.id,
          newStartsAt: at('2026-09-02', '10:00'),
        }),
      ),
    ).toBe('OUTSIDE_BOOKING_WINDOW');
    const h = must(await holdSlot(ctx, P(7), r(14, '10:00', 4)));
    expect(
      codeOf(
        await rescheduleAppointment(ctx, P(7), {
          appointmentId: h.id,
          newStartsAt: at(workday(15), '10:00'),
        }),
      ),
    ).toBe('INVALID_TRANSITION');
  });

  it('can move 15 minutes inside its own block (the visit does not clash with itself)', async () => {
    const a = await book(P(8), r(16, '10:00', 4));
    const moved = must(
      await rescheduleAppointment(ctx, P(8), {
        appointmentId: a.id,
        newStartsAt: at(workday(16), '10:15'),
      }),
    );
    expect(moved.startsAt.getTime()).toBe(at(workday(16), '10:15').getTime());
  });

  it("cannot move onto the patient's own other visit", async () => {
    const a = await book(P(9), r(17, '10:00', 4));
    await book(P(9), r(18, '10:00', 5));
    expect(
      codeOf(
        await rescheduleAppointment(ctx, P(9), {
          appointmentId: a.id,
          newStartsAt: at(workday(18), '10:15'),
        }),
      ),
    ).toBe('PATIENT_BUSY');
  });

  it('a late move (< 24h) counts as a late cancel; an early one is free', async () => {
    const a = await book(P(10), r(19, '10:00', 4));
    clock.now = new Date(a.startsAt.getTime() - 24 * HOUR); // exactly 24h: still free
    must(
      await rescheduleAppointment(ctx, P(10), {
        appointmentId: a.id,
        newStartsAt: at(workday(20), '10:00'),
      }),
    );
    expect(
      await count(
        t.db,
        sql`SELECT count(*)::int AS n FROM penalty_events WHERE patient_id = ${pid(10)}::uuid`,
      ),
    ).toBe(0);
    const b = await book(P(11), r(21, '10:00', 4));
    clock.now = new Date(b.startsAt.getTime() - 24 * HOUR + 1);
    must(
      await rescheduleAppointment(ctx, P(11), {
        appointmentId: b.id,
        newStartsAt: at(workday(22), '10:00'),
      }),
    );
    expect(
      await count(
        t.db,
        sql`SELECT count(*)::int AS n FROM penalty_events WHERE patient_id = ${pid(11)}::uuid AND kind = 'late_cancel'`,
      ),
    ).toBe(1);
    expect(
      await count(
        t.db,
        sql`SELECT count(*)::int AS n FROM appointment_events WHERE appointment_id = ${b.id}::uuid AND type = 'rescheduled' AND late`,
      ),
    ).toBe(1);
    clock.now = T0;
  });
});

describe('cancel', () => {
  it('free cancel (>= 24h): no penalty, reminders gone, time free, one email task', async () => {
    const a = await book(P(12), r(23, '10:00', 4));
    const c = must(
      await cancelAppointment(ctx, P(12), { appointmentId: a.id, reason: 'changed my mind' }),
    );
    expect(c.status).toBe('cancelled');
    expect(c.cancelledLate).toBe(false);
    expect(await pendingReminders(a.id)).toEqual([]);
    expect(
      await count(
        t.db,
        sql`SELECT count(*)::int AS n FROM penalty_events WHERE patient_id = ${pid(12)}::uuid`,
      ),
    ).toBe(0);
    expect(
      await count(
        t.db,
        sql`SELECT count(*)::int AS n FROM scheduled_tasks WHERE kind = 'email.cancelled' AND payload->>'appointmentId' = ${a.id}`,
      ),
    ).toBe(1);
    const ev = await rows<{ reason: string; late: boolean }>(
      t.db,
      sql`SELECT reason, late FROM appointment_events WHERE appointment_id = ${a.id}::uuid AND type = 'cancelled'`,
    );
    expect(ev).toEqual([{ reason: 'changed my mind', late: false }]);
  });

  it('exactly 24h before is free, one millisecond less is a late cancel', async () => {
    const a = await book(P(13), r(24, '10:00', 4));
    clock.now = new Date(a.startsAt.getTime() - 24 * HOUR);
    expect(must(await cancelAppointment(ctx, P(13), { appointmentId: a.id })).cancelledLate).toBe(
      false,
    );
    clock.now = T0;
    const b = await book(P(13), r(25, '10:00', 4));
    clock.now = new Date(b.startsAt.getTime() - 24 * HOUR + 1);
    const c = must(await cancelAppointment(ctx, P(13), { appointmentId: b.id }));
    expect(c.cancelledLate).toBe(true);
    expect(
      await count(
        t.db,
        sql`SELECT count(*)::int AS n FROM penalty_events WHERE patient_id = ${pid(13)}::uuid AND kind = 'late_cancel'`,
      ),
    ).toBe(1);
    clock.now = T0;
  });

  it('cancelling twice changes nothing and charges nothing twice', async () => {
    const a = await book(P(14), r(26, '10:00', 4));
    clock.now = new Date(a.startsAt.getTime() - 3 * HOUR);
    must(await cancelAppointment(ctx, P(14), { appointmentId: a.id }));
    must(await cancelAppointment(ctx, P(14), { appointmentId: a.id }));
    expect(
      await count(
        t.db,
        sql`SELECT count(*)::int AS n FROM penalty_events WHERE appointment_id = ${a.id}::uuid`,
      ),
    ).toBe(1);
    expect(
      await count(
        t.db,
        sql`SELECT count(*)::int AS n FROM appointment_events WHERE appointment_id = ${a.id}::uuid AND type = 'cancelled'`,
      ),
    ).toBe(1);
    clock.now = T0;
  });

  it('10 simultaneous cancels of one visit: one penalty, one email, no errors', async () => {
    const a = await book(P(15), r(27, '10:00', 4));
    clock.now = new Date(a.startsAt.getTime() - 3 * HOUR);
    const res = await Promise.all(
      Array.from({ length: 10 }, () => cancelAppointment(ctx, P(15), { appointmentId: a.id })),
    );
    expect(res.every((x) => x.ok)).toBe(true);
    expect(
      await count(
        t.db,
        sql`SELECT count(*)::int AS n FROM penalty_events WHERE appointment_id = ${a.id}::uuid`,
      ),
    ).toBe(1);
    expect(
      await count(
        t.db,
        sql`SELECT count(*)::int AS n FROM scheduled_tasks WHERE kind = 'email.cancelled' AND payload->>'appointmentId' = ${a.id}`,
      ),
    ).toBe(1);
    clock.now = T0;
  });

  it('a visit already in progress or finished cannot be cancelled', async () => {
    const a = await book(P(16), r(28, '10:00', 4));
    await t.db.execute(sql`UPDATE appointments SET status = 'checked_in' WHERE id = ${a.id}::uuid`);
    expect(codeOf(await cancelAppointment(ctx, P(16), { appointmentId: a.id }))).toBe(
      'INVALID_TRANSITION',
    );
  });

  it('abandoning a hold is not a late cancel', async () => {
    const h = must(await holdSlot(ctx, P(17), r(29, '10:00', 4)));
    clock.now = new Date(h.startsAt.getTime() - 3 * HOUR);
    const c = must(await cancelAppointment(ctx, P(17), { appointmentId: h.id }));
    expect(c.cancelledLate).toBe(false);
    expect(
      await count(
        t.db,
        sql`SELECT count(*)::int AS n FROM penalty_events WHERE patient_id = ${pid(17)}::uuid`,
      ),
    ).toBe(0);
    clock.now = T0;
  });
});

describe('2 no-shows / late cancels within 90 days close online booking for 30 days (acceptance 14)', () => {
  beforeAll(() => {
    cur = makeCtx(t.db, clock, { maxAdvanceDays: 400 });
  });
  afterAll(() => {
    cur = null;
  });
  const wide = () => makeCtx(t.db, clock, { maxAdvanceDays: 400 });
  const lateCancel = async (who: number, day: number, doc: number) => {
    const a = await book(P(who), r(day, '10:00', doc));
    clock.now = new Date(a.startsAt.getTime() - 2 * HOUR);
    must(await cancelAppointment(wide(), P(who), { appointmentId: a.id }));
    return clock.now;
  };
  const blockedUntil = async (who: number) =>
    (
      await rows<{ b: string | null }>(
        t.db,
        sql`SELECT online_booking_blocked_until AS b FROM patients WHERE id = ${pid(who)}::uuid`,
      )
    )[0]?.b ?? null;

  it('one is a warning, the second blocks for exactly 30 days, the registrar can still book', async () => {
    const t1 = await lateCancel(18, 30, 5);
    clock.now = T0;
    expect(await blockedUntil(18)).toBeNull();
    const t2 = await lateCancel(18, 31, 5);
    const until = await blockedUntil(18);
    expect(new Date(until as string).getTime()).toBe(t2.getTime() + 30 * DAY);
    expect(t2.getTime()).toBeGreaterThan(t1.getTime());
    clock.now = new Date(t2.getTime() + DAY);
    const later = wide();
    expect(codeOf(await holdSlot(later, P(18), r(50, '10:00', 5)))).toBe('ONLINE_BOOKING_BLOCKED');
    expect(
      codeOf(await holdSlot(later, w.registrar.kyiv, { ...r(50, '10:00', 5), patientId: pid(18) })),
    ).toBe('ok');
    clock.now = new Date(t2.getTime() + 30 * DAY); // block ends exactly now
    expect(codeOf(await holdSlot(wide(), P(18), r(120, '10:00', 5)))).toBe('ok');
    clock.now = T0;
  });

  it('a no-show and a late cancel together also count', async () => {
    const a = await book(P(19), r(30, '11:00', 5));
    clock.now = new Date(a.startsAt.getTime() + 20 * MIN);
    must(await markNoShow(wide(), w.registrar.kyiv, a.id));
    clock.now = T0;
    const b2 = await book(P(19), r(34, '11:00', 5));
    clock.now = new Date(b2.startsAt.getTime() - HOUR);
    must(await cancelAppointment(wide(), P(19), { appointmentId: b2.id }));
    expect(await blockedUntil(19)).not.toBeNull();
    clock.now = T0;
  });

  it('two penalties more than 90 days apart do not block', async () => {
    const a = await book(P(20), r(30, '12:00', 5));
    clock.now = new Date(a.startsAt.getTime() - 2 * HOUR);
    must(await cancelAppointment(wide(), P(20), { appointmentId: a.id }));
    // 100 days later: a second late cancel (use a visit far enough in the future in a later "now")
    clock.now = new Date(T0.getTime() + 100 * DAY);
    const later = wide();
    const start = new Date(at(workday(100), '12:00'));
    const h = must(
      await holdSlot(later, P(20), {
        clinicId: w.kyiv,
        doctorId: w.kyivDoctors[5] as string,
        serviceId: w.c30,
        startsAt: start,
      }),
    );
    const b = must(
      await confirmBooking(later, P(20), { appointmentId: h.id, idempotencyKey: k() }),
    );
    clock.now = new Date(b.startsAt.getTime() - 2 * HOUR);
    must(await cancelAppointment(later, P(20), { appointmentId: b.id }));
    expect(await blockedUntil(20)).toBeNull();
    clock.now = T0;
  });
});
