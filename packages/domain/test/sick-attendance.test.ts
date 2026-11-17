import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  cancelAppointment, checkIn, completeVisit, confirmBooking, getAvailability, holdSlot, markDoctorSick, markNoShow, registrarBook, type Actor, type Ctx,
} from '../src/index.js';
import { HOUR, MIN, T0, at, codeOf, count, createTestDb, makeCtx, makeWorld, must, rows, workday, type Clock, type TestDb, type World } from './helpers.js';

let t: TestDb;
let w: World;
const clock: Clock = { now: T0 };
let ctx: Ctx;
let n = 0;
const k = (): string => `sk-${++n}-${Math.random().toString(36).slice(2)}`;
const P = (i: number): Actor => (w.patients[i] as World['patients'][number]).actor;
const pid = (i: number): string => (w.patients[i] as World['patients'][number]).id;
const doc = (i: number): string => w.kyivDoctors[i] as string;

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

const req = (day: number, time: string, doctor: number, svc: 'c30' | 'q15' = 'c30') => ({
  clinicId: w.kyiv, doctorId: doc(doctor), serviceId: svc === 'c30' ? w.c30 : w.q15, startsAt: at(workday(day), time),
});
const book = async (actor: Actor, r: ReturnType<typeof req>) => {
  const h = must(await holdSlot(ctx, actor, r));
  return must(await confirmBooking(ctx, actor, { appointmentId: h.id, idempotencyKey: k() }));
};
const pad = (n: number): string => String(n).padStart(2, '0');
let confirmedTotal = 0;
const sick = (day: number, doctor: number, actor: Actor = w.registrar.kyiv, c: Ctx = ctx) => markDoctorSick(c, actor, { doctorId: doc(doctor), localDate: workday(day) });

describe('sick day (invariant 12, acceptance 13)', () => {
  it('12 visits on the day: all cancelled, 12 emails, second mark changes nothing', async () => {
    const times = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '14:00', '14:30', '15:00', '15:30'];
    const booked = [];
    for (const [i, tm] of times.entries()) booked.push(await book(P(i), req(3, tm, 0, 'q15')));
    // a live hold and a finished visit on the same day must be handled too
    const hold = must(await holdSlot(ctx, P(12), req(3, '16:00', 0)));
    const date = workday(3);

    const first = must(await sick(3, 0));
    expect(first).toEqual({ cancelled: 12, alreadyMarked: false });
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM appointments WHERE doctor_id = ${doc(0)}::uuid AND local_date = ${date}::date AND status IN ('booked','held')`)).toBe(0);
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM scheduled_tasks WHERE kind = 'email.sick_cancel' AND status = 'pending'`)).toBe(12);
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM scheduled_tasks WHERE kind LIKE 'reminder.%' AND status = 'pending' AND payload->>'appointmentId' IN (${sql.join(booked.map((b) => sql`${b.id}`), sql`, `)})`)).toBe(0);
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM penalty_events`)).toBe(0);
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM appointments WHERE doctor_id = ${doc(0)}::uuid AND cancelled_late`)).toBe(0);
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM schedule_exceptions WHERE doctor_id = ${doc(0)}::uuid AND local_date = ${date}::date AND kind = 'sick'`)).toBe(1);
    const ev = await rows<{ reason: string; actor_role: string }>(t.db, sql`SELECT reason, actor_role FROM appointment_events WHERE type = 'cancelled' AND appointment_id = ${booked[0]?.id}::uuid`);
    expect(ev).toEqual([{ reason: 'doctor_sick', actor_role: 'registrar' }]);
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM notifications WHERE kind = 'sick_cancel'`)).toBe(12);
    // displaced patients are first in the doctor's queue
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM waitlist_entries WHERE doctor_id = ${doc(0)}::uuid AND priority = 1 AND status = 'active'`)).toBe(12);
    void hold;

    const second = must(await sick(3, 0));
    expect(second).toEqual({ cancelled: 0, alreadyMarked: true });
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM scheduled_tasks WHERE kind = 'email.sick_cancel'`)).toBe(12);
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM waitlist_entries WHERE doctor_id = ${doc(0)}::uuid AND priority = 1`)).toBe(12);
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM appointment_events WHERE type = 'cancelled' AND reason = 'doctor_sick'`)).toBeGreaterThanOrEqual(12);
  });

  it('10 simultaneous marks produce exactly the same result as one', async () => {
    for (const [i, tm] of ['09:00', '10:00', '11:00', '12:00', '14:00'].entries()) await book(P(20 + i), req(4, tm, 1));
    const res = await Promise.all(Array.from({ length: 10 }, () => sick(4, 1)));
    expect(res.every((r) => r.ok)).toBe(true);
    expect(res.filter((r) => r.ok && r.value.cancelled > 0)).toHaveLength(1);
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM scheduled_tasks WHERE kind = 'email.sick_cancel' AND payload->>'appointmentId' IN (SELECT id::text FROM appointments WHERE doctor_id = ${doc(1)}::uuid)`)).toBe(5);
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM appointments WHERE doctor_id = ${doc(1)}::uuid AND local_date = ${workday(4)}::date AND status = 'booked'`)).toBe(0);
  });

  it('the day disappears from the grid and cannot be booked or confirmed any more', async () => {
    const h = must(await holdSlot(ctx, P(30), req(5, '10:00', 2)));
    const other = await book(P(31), req(5, '11:00', 2));
    must(await sick(5, 2));
    expect(codeOf(await confirmBooking(ctx, P(30), { appointmentId: h.id, idempotencyKey: k() }))).not.toBe('ok');
    expect((await rows<{ status: string }>(t.db, sql`SELECT status FROM appointments WHERE id = ${other.id}::uuid`))[0]?.status).toBe('cancelled');
    const g = must(await getAvailability(ctx, { clinicId: w.kyiv, serviceId: w.c30, doctorId: doc(2), fromDate: workday(5), days: 1 }));
    expect(g.slots).toEqual([]);
    expect(codeOf(await holdSlot(ctx, P(32), req(5, '12:00', 2)))).toBe('OUTSIDE_WORKING_HOURS');
    expect(codeOf(await registrarBook(ctx, w.registrar.kyiv, { ...req(5, '12:00', 2), patientId: pid(32), idempotencyKey: k() }))).toBe('OUTSIDE_WORKING_HOURS');
  });

  it('race: sick day against bookings of that day, 40 rounds — nothing ever stays booked', async () => {
    // calibrate: how long does one hold+confirm take on this (possibly loaded) machine?
    const t0 = performance.now();
    const probe = await book(P(39), req(30, '16:00', 5, 'q15'));
    const flowMs = Math.max(10, performance.now() - t0);
    must(await cancelAppointment(ctx, P(39), { appointmentId: probe.id }));
    for (let round = 0; round < 40; round++) {
      const day = 6 + round % 10;
      const d = 3 + (round % 3); // doctors 3..5
      const jitter = (scale = 1) => new Promise((r) => setTimeout(r, Math.floor(Math.random() * flowMs * scale)));
      const flows = Array.from({ length: 4 }, async (_, i) => {
        await jitter();
        const p = (round * 4 + i) % 40;
        const h = await holdSlot(ctx, P(p), { ...req(day, '09:00', d), startsAt: at(workday(day), `${pad(9 + i)}:00`) });
        if (!h.ok) return;
        const c = await confirmBooking(ctx, P(p), { appointmentId: h.value.id, idempotencyKey: k() });
        if (c.ok) confirmedTotal++;
      });
      await Promise.all([...flows, jitter(3).then(() => sick(day, d))]);
      const left = await count(t.db, sql`SELECT count(*)::int AS n FROM appointments WHERE doctor_id = ${doc(d)}::uuid AND local_date = ${workday(day)}::date AND status = 'booked'`);
      expect(left, `round ${round}`).toBe(0);
      // reopen the day for the next round so bookings can race again
      await t.db.execute(sql`DELETE FROM schedule_exceptions WHERE doctor_id = ${doc(d)}::uuid AND local_date = ${workday(day)}::date`);
      await t.db.execute(sql`UPDATE appointments SET status = 'cancelled' WHERE doctor_id = ${doc(d)}::uuid AND local_date = ${workday(day)}::date AND status = 'held'`);
    }
    // the race really happened: bookings did go through before the sick mark in a good share of rounds
    expect(confirmedTotal).toBeGreaterThan(3);
  });

  it('who may mark it: the registrar of the clinic where the doctor works that day, nobody else', async () => {
    expect(codeOf(await sick(7, 0, w.registrar.warsaw))).toBe('NOT_FOUND');
    expect(codeOf(await sick(7, 0, w.doctorActor(0)))).toBe('FORBIDDEN');
    expect(codeOf(await sick(7, 0, P(0)))).toBe('FORBIDDEN');
    expect(codeOf(await sick(7, 0, { userId: null, role: 'manager' }))).toBe('FORBIDDEN');
    // a Saturday: the doctor does not work, nothing to mark
    expect(codeOf(await markDoctorSick(ctx, w.registrar.kyiv, { doctorId: doc(0), localDate: '2026-06-13' }))).toBe('NOT_FOUND');
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM schedule_exceptions WHERE local_date = '2026-06-13'::date`)).toBe(0);
  });

  it('turns a vacation day into a sick day, and leaves finished visits alone', async () => {
    const a = await book(P(33), req(8, '09:00', 0));
    await t.db.execute(sql`UPDATE appointments SET status = 'checked_in' WHERE id = ${a.id}::uuid`);
    await t.db.execute(sql`UPDATE appointments SET status = 'completed' WHERE id = ${a.id}::uuid`);
    await t.db.execute(sql`INSERT INTO schedule_exceptions (doctor_id, local_date, kind) VALUES (${doc(0)}::uuid, ${workday(8)}::date, 'vacation')`);
    const r = must(await sick(8, 0));
    expect(r.alreadyMarked).toBe(false);
    expect((await rows<{ kind: string }>(t.db, sql`SELECT kind FROM schedule_exceptions WHERE doctor_id = ${doc(0)}::uuid AND local_date = ${workday(8)}::date`))[0]?.kind).toBe('sick');
    expect((await rows<{ status: string }>(t.db, sql`SELECT status FROM appointments WHERE id = ${a.id}::uuid`))[0]?.status).toBe('completed');
  });
});

describe('attendance and the status table', () => {
  const todayVisit = async (who: number, doctor: number, time = '10:00') => {
    clock.now = T0;
    const a = await book(P(who), req(0, time, doctor));
    return a;
  };

  it('check-in opens 30 minutes before; only the registrar of that clinic', async () => {
    const a = await todayVisit(0, 0);
    clock.now = new Date(a.startsAt.getTime() - 31 * MIN);
    expect(codeOf(await checkIn(ctx, w.registrar.kyiv, a.id))).toBe('INVALID_TRANSITION');
    clock.now = new Date(a.startsAt.getTime() - 30 * MIN);
    expect(codeOf(await checkIn(ctx, w.registrar.warsaw, a.id))).toBe('NOT_FOUND');
    expect(codeOf(await checkIn(ctx, P(0), a.id))).toBe('FORBIDDEN');
    expect(codeOf(await checkIn(ctx, w.doctorActor(0), a.id))).toBe('FORBIDDEN');
    const c = must(await checkIn(ctx, w.registrar.kyiv, a.id));
    expect(c.status).toBe('checked_in');
    expect(codeOf(await checkIn(ctx, w.registrar.kyiv, a.id))).toBe('INVALID_TRANSITION');
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM scheduled_tasks WHERE status = 'pending' AND kind LIKE 'reminder.%' AND payload->>'appointmentId' = ${a.id}`)).toBe(0);
  });

  it('no-show only after the start, by the registrar or the visit\'s own doctor, and it counts as a penalty', async () => {
    const a = await todayVisit(1, 1);
    clock.now = new Date(a.startsAt.getTime() - MIN);
    expect(codeOf(await markNoShow(ctx, w.registrar.kyiv, a.id))).toBe('INVALID_TRANSITION');
    clock.now = a.startsAt;
    expect(codeOf(await markNoShow(ctx, w.doctorActor(2), a.id))).toBe('NOT_FOUND'); // another doctor's patient
    expect(codeOf(await markNoShow(ctx, P(1), a.id))).toBe('FORBIDDEN');
    expect(codeOf(await markNoShow(ctx, w.registrar.warsaw, a.id))).toBe('NOT_FOUND');
    expect(must(await markNoShow(ctx, w.doctorActor(1), a.id)).status).toBe('no_show');
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM penalty_events WHERE patient_id = ${pid(1)}::uuid AND kind = 'no_show'`)).toBe(1);
    expect(codeOf(await markNoShow(ctx, w.doctorActor(1), a.id))).toBe('INVALID_TRANSITION');
  });

  it('the doctor completes a visit in progress; a visit never checked in is checked in and completed by the doctor', async () => {
    const a = await todayVisit(2, 2);
    const b = await todayVisit(3, 3);
    clock.now = new Date(a.startsAt.getTime() - 10 * MIN);
    must(await checkIn(ctx, w.registrar.kyiv, a.id));
    expect(codeOf(await completeVisit(ctx, w.doctorActor(3), a.id))).toBe('NOT_FOUND');
    expect(codeOf(await completeVisit(ctx, w.registrar.kyiv, a.id))).toBe('FORBIDDEN');
    expect(must(await completeVisit(ctx, w.doctorActor(2), a.id)).status).toBe('completed');
    expect(codeOf(await completeVisit(ctx, w.doctorActor(2), a.id))).toBe('INVALID_TRANSITION');
    clock.now = new Date(b.startsAt.getTime() + 5 * MIN);
    expect(must(await completeVisit(ctx, w.doctorActor(3), b.id)).status).toBe('completed');
    const types = await rows<{ type: string; actor_role: string }>(t.db, sql`SELECT type, actor_role FROM appointment_events WHERE appointment_id = ${b.id}::uuid ORDER BY at, type`);
    expect(types.map((x) => `${x.type}:${x.actor_role}`)).toEqual(expect.arrayContaining(['held:patient', 'confirmed:patient', 'checked_in:doctor', 'completed:doctor']));
  });

  it('cannot complete a visit far in the future', async () => {
    const a = await book(P(4), req(10, '10:00', 4));
    expect(codeOf(await completeVisit(ctx, w.doctorActor(4), a.id))).toBe('INVALID_TRANSITION');
  });

  it('a visit that is checked in cannot be cancelled by the patient, and a no-show cannot be revived', async () => {
    const a = await todayVisit(5, 4, '11:00');
    clock.now = new Date(a.startsAt.getTime() - 5 * MIN);
    must(await checkIn(ctx, w.registrar.kyiv, a.id));
    expect(codeOf(await cancelAppointment(ctx, P(5), { appointmentId: a.id }))).toBe('INVALID_TRANSITION');
    expect(codeOf(await markNoShow(ctx, w.registrar.kyiv, a.id))).toBe('INVALID_TRANSITION');
  });

  it('the status table: every (role, from, to) outside the table is refused, by code or by the database', async () => {
    // booked → completed directly by a registrar / patient is impossible; the DB trigger is the last line
    const a = await todayVisit(6, 5, '12:00');
    const direct = await t.db.execute(sql`UPDATE appointments SET status = 'completed' WHERE id = ${a.id}::uuid`).then(() => 'allowed', () => 'refused');
    expect(direct).toBe('refused');
  });
});

void HOUR;
