import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  acceptOffer, cancelAppointment, confirmBooking, declineOffer, expireHold, expireOffer, getAvailability, holdSlot, joinWaitlist, leaveWaitlist, type Actor, type Ctx,
} from '../src/index.js';
import { HOUR, MIN, T0, at, codeOf, count, createTestDb, makeCtx, makeWorld, must, rows, workday, type Clock, type TestDb, type World } from './helpers.js';

let t: TestDb;
let w: World;
const clock: Clock = { now: T0 };
let ctx: Ctx;
let n = 0;
const k = (): string => `wk-${++n}-${Math.random().toString(36).slice(2)}`;
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
beforeEach(async () => {
  clock.now = T0;
  // every test starts with an empty queue (entries of earlier tests would legitimately compete)
  await t.db.execute(sql`UPDATE waitlist_entries SET status = 'cancelled' WHERE status = 'active'`);
});

const slotReq = (day: number, time: string, doctor: number, svc: 'c30' | 'q15' | 'u30' = 'c30') => ({
  clinicId: w.kyiv,
  doctorId: w.kyivDoctors[doctor] as string,
  serviceId: svc === 'c30' ? w.c30 : svc === 'q15' ? w.q15 : w.u30,
  startsAt: at(workday(day), time),
});
const book = async (actor: Actor, req: ReturnType<typeof slotReq>) => {
  const h = must(await holdSlot(ctx, actor, req));
  return must(await confirmBooking(ctx, actor, { appointmentId: h.id, idempotencyKey: k() }));
};
const join = async (who: number, doctor: number, day: number, spanDays = 5, svc: 'c30' | 'q15' = 'c30', priorityMinutes = 0) => {
  clock.now = new Date(T0.getTime() + priorityMinutes * MIN);
  const e = must(await joinWaitlist(ctx, P(who), { doctorId: w.kyivDoctors[doctor] as string, serviceId: svc === 'c30' ? w.c30 : w.q15, fromDate: workday(day), toDate: workday(day + spanDays) }));
  clock.now = T0;
  return e;
};
type Offer = { id: string; entry_id: string; status: string; appointment_id: string; expires_at: string; patient_id: string };
const offers = (doctorId: string, startsAt: Date) =>
  rows<Offer>(t.db, sql`SELECT o.id, o.entry_id, o.status, o.appointment_id, o.expires_at, a.patient_id FROM waitlist_offers o JOIN appointments a ON a.id = o.appointment_id JOIN waitlist_entries e ON e.id = o.entry_id WHERE a.doctor_id = ${doctorId}::uuid AND a.starts_at = ${startsAt.toISOString()}::timestamptz ORDER BY e.created_at, o.id`);
const live = (doctorId: string, startsAt: Date) =>
  count(t.db, sql`SELECT count(*)::int AS n FROM appointments WHERE doctor_id = ${doctorId}::uuid AND starts_at = ${startsAt.toISOString()}::timestamptz AND status IN ('held','booked')`);
const inGrid = async (doctor: number, day: number, startsAt: Date): Promise<boolean> => {
  const g = must(await getAvailability(ctx, { clinicId: w.kyiv, serviceId: w.c30, doctorId: w.kyivDoctors[doctor] as string, fromDate: workday(day), days: 1 }));
  return g.slots.some((s) => s.startsAt.getTime() === startsAt.getTime());
};

describe('waiting list: the main story (acceptance 8)', () => {
  it('cancel → first in queue is offered the time for 15 minutes; others see nothing; the slot is never free in between', async () => {
    const a = await book(P(0), slotReq(3, '10:00', 0));
    await join(1, 0, 3, 5, 'c30', 0);
    await join(2, 0, 3, 5, 'c30', 1);
    await join(3, 0, 3, 5, 'c30', 2);
    expect(await inGrid(0, 3, a.startsAt)).toBe(false);

    must(await cancelAppointment(ctx, P(0), { appointmentId: a.id }));
    const o1 = await offers(a.doctorId, a.startsAt);
    expect(o1).toHaveLength(1);
    expect(o1[0]?.patient_id).toBe(pid(1)); // first by request time
    expect(new Date(o1[0]?.expires_at as string).getTime()).toBe(T0.getTime() + 15 * MIN);
    expect(await inGrid(0, 3, a.startsAt)).toBe(false); // hidden for everyone while offered
    expect(codeOf(await holdSlot(ctx, P(5), slotReq(3, '10:00', 0)))).toBe('SLOT_TAKEN');
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM scheduled_tasks WHERE status='pending' AND payload->>'offerId' = ${o1[0]?.id as string}`)).toBe(2); // expiry + email
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM notifications WHERE kind = 'waitlist_offer'`)).toBeGreaterThanOrEqual(1);

    // 14 min 59 s: not due, nothing moves
    clock.now = new Date(T0.getTime() + 15 * MIN - 1000);
    expect(must(await expireOffer(ctx, o1[0]?.id as string)).outcome).toBe('not_due');
    expect(await offers(a.doctorId, a.startsAt)).toHaveLength(1);

    // first did not answer for 15 minutes → second gets it, the time was never visible as free
    clock.now = new Date(T0.getTime() + 15 * MIN);
    const exp = must(await expireOffer(ctx, o1[0]?.id as string));
    expect(exp.outcome).toBe('closed');
    const o2 = await offers(a.doctorId, a.startsAt);
    expect(o2.map((o) => [o.patient_id, o.status])).toEqual([[pid(1), 'expired'], [pid(2), 'pending']]);
    expect(await live(a.doctorId, a.startsAt)).toBe(1);
    expect(await inGrid(0, 3, a.startsAt)).toBe(false);
    expect(new Date(o2[1]?.expires_at as string).getTime()).toBe(clock.now.getTime() + 15 * MIN);

    // second declines → third
    must(await declineOffer(ctx, P(2), o2[1]?.id as string));
    const o3 = await offers(a.doctorId, a.startsAt);
    expect(o3.map((o) => o.status)).toEqual(['expired', 'declined', 'pending']);
    expect(o3[2]?.patient_id).toBe(pid(3));
    expect(await inGrid(0, 3, a.startsAt)).toBe(false);

    // third accepts
    const acc = must(await acceptOffer(ctx, P(3), { offerId: o3[2]?.id as string, idempotencyKey: k() }));
    expect(acc.status).toBe('booked');
    expect(acc.patientId).toBe(pid(3));
    expect((await offers(a.doctorId, a.startsAt)).map((o) => o.status)).toEqual(['expired', 'declined', 'accepted']);
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM waitlist_entries WHERE patient_id = ${pid(3)}::uuid AND status = 'fulfilled'`)).toBe(1);
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM scheduled_tasks WHERE payload->>'appointmentId' = ${acc.id} AND kind LIKE 'reminder.%' AND status = 'pending'`)).toBe(2);
    expect(await live(a.doctorId, a.startsAt)).toBe(1);
  });

  it('when the queue runs out the time becomes free at once', async () => {
    const a = await book(P(6), slotReq(4, '10:00', 0));
    await join(7, 0, 4);
    must(await cancelAppointment(ctx, P(6), { appointmentId: a.id }));
    const [o] = await offers(a.doctorId, a.startsAt);
    must(await declineOffer(ctx, P(7), o?.id as string));
    expect(await live(a.doctorId, a.startsAt)).toBe(0);
    expect(await inGrid(0, 4, a.startsAt)).toBe(true);
    // and the decliner is not offered the same time again
    expect(await offers(a.doctorId, a.startsAt)).toHaveLength(1);
  });

  it('nobody waiting: the cancelled time is simply free', async () => {
    const a = await book(P(8), slotReq(5, '10:00', 0));
    must(await cancelAppointment(ctx, P(8), { appointmentId: a.id }));
    expect(await offers(a.doctorId, a.startsAt)).toHaveLength(0);
    expect(await inGrid(0, 5, a.startsAt)).toBe(true);
  });

  it('accepting after the 15 minutes is refused', async () => {
    const a = await book(P(9), slotReq(6, '10:00', 0));
    await join(10, 0, 6);
    must(await cancelAppointment(ctx, P(9), { appointmentId: a.id }));
    const [o] = await offers(a.doctorId, a.startsAt);
    clock.now = new Date(T0.getTime() + 15 * MIN);
    expect(codeOf(await acceptOffer(ctx, P(10), { offerId: o?.id as string, idempotencyKey: k() }))).toBe('OFFER_EXPIRED');
    expect(codeOf(await declineOffer(ctx, P(10), o?.id as string))).toBe('OFFER_EXPIRED');
    // even after the worker released it
    must(await expireOffer(ctx, o?.id as string));
    expect(codeOf(await acceptOffer(ctx, P(10), { offerId: o?.id as string, idempotencyKey: k() }))).toBe('OFFER_EXPIRED');
  });

  it('only the offered patient can answer', async () => {
    const a = await book(P(11), slotReq(7, '10:00', 0));
    await join(12, 0, 7);
    must(await cancelAppointment(ctx, P(11), { appointmentId: a.id }));
    const [o] = await offers(a.doctorId, a.startsAt);
    expect(codeOf(await acceptOffer(ctx, P(13), { offerId: o?.id as string, idempotencyKey: k() }))).toBe('NOT_FOUND');
    expect(codeOf(await declineOffer(ctx, P(13), o?.id as string))).toBe('NOT_FOUND');
    expect(codeOf(await acceptOffer(ctx, w.registrar.warsaw, { offerId: o?.id as string, idempotencyKey: k() }))).toBe('NOT_FOUND');
    expect(codeOf(await acceptOffer(ctx, P(12), { offerId: '00000000-0000-4000-8000-000000000000', idempotencyKey: k() }))).toBe('NOT_FOUND');
  });
});

describe('who is "suitable"', () => {
  it('skips people whose range, doctor, limit or calendar do not fit, but keeps them in the queue', async () => {
    const a = await book(P(14), slotReq(8, '10:00', 0));
    await join(15, 0, 20, 5, 'c30', 0); // range starts much later: no match
    await join(16, 1, 8, 5, 'c30', 1); // other doctor
    for (const d of [30, 31, 32]) await book(P(17), slotReq(d, '09:00', 3)); // at the 3-visit limit
    await join(17, 0, 8, 5, 'c30', 2);
    await book(P(18), slotReq(8, '10:15', 2)); // busy with another doctor at the same time
    await join(18, 0, 8, 5, 'c30', 3);
    await join(19, 0, 8, 5, 'c30', 4); // the one who gets it
    await join(20, 0, 8, 5, 'c30', 5);
    must(await cancelAppointment(ctx, P(14), { appointmentId: a.id }));
    const o = await offers(a.doctorId, a.startsAt);
    expect(o.map((x) => x.patient_id)).toEqual([pid(19)]);
    for (const who of [15, 16, 17, 18, 20])
      expect(await count(t.db, sql`SELECT count(*)::int AS n FROM waitlist_entries WHERE patient_id = ${pid(who)}::uuid AND status = 'active'`), `p${who}`).toBe(1);
  });

  it('a person who already has an open offer is not given a second time at once', async () => {
    const a = await book(P(21), slotReq(9, '10:00', 0));
    const b = await book(P(22), slotReq(9, '11:00', 0));
    await join(23, 0, 9, 3, 'c30', 0);
    await join(24, 0, 9, 3, 'c30', 1);
    must(await cancelAppointment(ctx, P(21), { appointmentId: a.id }));
    must(await cancelAppointment(ctx, P(22), { appointmentId: b.id }));
    expect((await offers(a.doctorId, a.startsAt))[0]?.patient_id).toBe(pid(23));
    expect((await offers(b.doctorId, b.startsAt))[0]?.patient_id).toBe(pid(24));
  });

  it('priority entries (displaced by a sick day) go first, ahead of earlier ordinary ones', async () => {
    const a = await book(P(25), slotReq(10, '10:00', 0));
    await join(26, 0, 10, 3, 'c30', 0);
    const vip = await join(27, 0, 10, 3, 'c30', 30);
    await t.db.execute(sql`UPDATE waitlist_entries SET priority = 1 WHERE id = ${vip.id}::uuid`);
    must(await cancelAppointment(ctx, P(25), { appointmentId: a.id }));
    expect((await offers(a.doctorId, a.startsAt))[0]?.patient_id).toBe(pid(27));
  });

  it('a time less than 2 hours away is not offered (nobody could book it)', async () => {
    const a = await book(P(28), slotReq(11, '10:00', 0));
    await join(29, 0, 11);
    clock.now = new Date(a.startsAt.getTime() - 90 * MIN);
    must(await cancelAppointment(ctx, P(28), { appointmentId: a.id }));
    expect(await offers(a.doctorId, a.startsAt)).toHaveLength(0);
  });

  it('a patient whose online booking is blocked still receives offers and may accept them', async () => {
    const a = await book(P(30), slotReq(12, '10:00', 0));
    await join(31, 0, 12);
    await t.db.execute(sql`UPDATE patients SET online_booking_blocked_until = ${new Date(T0.getTime() + 20 * 86_400_000).toISOString()}::timestamptz WHERE id = ${pid(31)}::uuid`);
    must(await cancelAppointment(ctx, P(30), { appointmentId: a.id }));
    const [o] = await offers(a.doctorId, a.startsAt);
    expect(o?.patient_id).toBe(pid(31));
    expect(codeOf(await acceptOffer(ctx, P(31), { offerId: o?.id as string, idempotencyKey: k() }))).toBe('ok');
  });

  it('a regular hold that expires also hands the time on', async () => {
    const h = must(await holdSlot(ctx, P(32), slotReq(13, '10:00', 0)));
    await join(33, 0, 13);
    clock.now = new Date(T0.getTime() + 10 * MIN);
    expect(must(await expireHold(ctx, h.id)).released).toBe(true);
    expect((await offers(h.doctorId, h.startsAt))[0]?.patient_id).toBe(pid(33));
    expect(await live(h.doctorId, h.startsAt)).toBe(1);
  });

  it('works for ultrasound services: the room stays reserved by the offer', async () => {
    const h = await book(P(34), slotReq(14, '11:00', 0, 'u30'));
    clock.now = T0;
    const e = must(await joinWaitlist(ctx, P(35), { doctorId: w.kyivDoctors[1] as string, serviceId: w.u30, fromDate: workday(14), toDate: workday(15) }));
    expect(e.status).toBe('active');
    must(await cancelAppointment(ctx, P(34), { appointmentId: h.id }));
    // the freed time belongs to doctor 0; entry was for doctor 1 so no offer; room is free again
    expect(await offers(h.doctorId, h.startsAt)).toHaveLength(0);
    const e2 = must(await joinWaitlist(ctx, P(36), { doctorId: w.kyivDoctors[0] as string, serviceId: w.u30, fromDate: workday(14), toDate: workday(15) }));
    const h2 = await book(P(37), slotReq(14, '11:00', 0, 'u30'));
    must(await cancelAppointment(ctx, P(37), { appointmentId: h2.id }));
    const [o] = await offers(h2.doctorId, h2.startsAt);
    expect(o?.patient_id).toBe(pid(36));
    // another doctor cannot take the room at that time while it is offered
    const other = await holdSlot(ctx, P(38), slotReq(14, '11:00', 3, 'u30'));
    expect(['ROOM_TAKEN', 'SLOT_TAKEN']).toContain(codeOf(other));
    expect(e2.status).toBe('active');
  });
});

describe('concurrency', () => {
  it('5 workers expire the same offer at once: exactly one hand-over, one live row', async () => {
    const a = await book(P(0), slotReq(16, '10:00', 1));
    await join(1, 1, 16, 3, 'c30', 0);
    await join(2, 1, 16, 3, 'c30', 1);
    await join(3, 1, 16, 3, 'c30', 2);
    must(await cancelAppointment(ctx, P(0), { appointmentId: a.id }));
    const [o] = await offers(a.doctorId, a.startsAt);
    clock.now = new Date(T0.getTime() + 15 * MIN);
    const res = await Promise.all(Array.from({ length: 5 }, () => expireOffer(ctx, o?.id as string)));
    expect(res.every((r) => r.ok)).toBe(true);
    expect(res.filter((r) => r.ok && r.value.outcome === 'closed')).toHaveLength(1);
    const all = await offers(a.doctorId, a.startsAt);
    expect(all.map((x) => x.status)).toEqual(['expired', 'pending']);
    expect(await live(a.doctorId, a.startsAt)).toBe(1);
  });

  it('two cancellations at the same moment never give both times to one person', async () => {
    const a = await book(P(4), slotReq(17, '10:00', 1));
    const b = await book(P(5), slotReq(17, '11:00', 1));
    await join(6, 1, 17, 3, 'c30', 0);
    await join(7, 1, 17, 3, 'c30', 1);
    await Promise.all([cancelAppointment(ctx, P(4), { appointmentId: a.id }), cancelAppointment(ctx, P(5), { appointmentId: b.id })]);
    const oa = await offers(a.doctorId, a.startsAt);
    const ob = await offers(b.doctorId, b.startsAt);
    const got = [...oa, ...ob].map((x) => x.patient_id).sort();
    expect(new Set(got).size).toBe(got.length);
    expect(await live(a.doctorId, a.startsAt)).toBeLessThanOrEqual(1);
    expect(await live(b.doctorId, b.startsAt)).toBeLessThanOrEqual(1);
  });

  it('a patient grabbing the freed time while it is being handed over cannot get it twice', async () => {
    const a = await book(P(8), slotReq(18, '10:00', 1));
    await join(9, 1, 18);
    const [cancel, grab1, grab2] = await Promise.all([
      cancelAppointment(ctx, P(8), { appointmentId: a.id }),
      holdSlot(ctx, P(10), slotReq(18, '10:00', 1)),
      holdSlot(ctx, P(11), slotReq(18, '10:00', 1)),
    ]);
    expect(cancel.ok).toBe(true);
    expect(await live(a.doctorId, a.startsAt)).toBe(1);
    // the freed time went to the person waiting, atomically; neither grabber can have it
    expect([grab1, grab2].filter((x) => x.ok)).toHaveLength(0);
    const o = await offers(a.doctorId, a.startsAt);
    expect(o).toHaveLength(1);
    expect(o[0]?.patient_id).toBe(pid(9));
    expect(await live(a.doctorId, a.startsAt)).toBe(1);
  });

  it('global invariant: never two live rows at one doctor time', async () => {
    const dup = await rows(t.db, sql`SELECT doctor_id, starts_at FROM appointments WHERE status IN ('held','booked','checked_in') GROUP BY 1,2 HAVING count(*) > 1`);
    expect(dup).toEqual([]);
  });
});

describe('joining and leaving', () => {
  it('limits: 5 active requests, duplicates collapse, doctor must provide the service', async () => {
    for (let i = 0; i < 5; i++) must(await joinWaitlist(ctx, P(0), { doctorId: w.kyivDoctors[i] as string, serviceId: w.c30, fromDate: workday(20), toDate: workday(22) }));
    expect(codeOf(await joinWaitlist(ctx, P(0), { doctorId: w.kyivDoctors[5] as string, serviceId: w.c30, fromDate: workday(20), toDate: workday(22) }))).toBe('WAITLIST_LIMIT_REACHED');
    const again = must(await joinWaitlist(ctx, P(0), { doctorId: w.kyivDoctors[0] as string, serviceId: w.c30, fromDate: workday(21), toDate: workday(23) }));
    expect(again.doctorId).toBe(w.kyivDoctors[0]);
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM waitlist_entries WHERE patient_id = ${pid(0)}::uuid AND status = 'active'`)).toBe(5);
    await t.db.execute(sql`DELETE FROM doctor_services WHERE doctor_id = ${w.kyivDoctors[3]}::uuid AND service_id = ${w.u30}::uuid`);
    expect(codeOf(await joinWaitlist(ctx, P(1), { doctorId: w.kyivDoctors[3] as string, serviceId: w.u30, fromDate: workday(20), toDate: workday(22) }))).toBe('SERVICE_NOT_PROVIDED');
  });
  it('only patients join; leaving is for the owner', async () => {
    expect(codeOf(await joinWaitlist(ctx, w.registrar.kyiv, { doctorId: w.kyivDoctors[0] as string, serviceId: w.c30, fromDate: workday(20), toDate: workday(22) }))).toBe('FORBIDDEN');
    const e = must(await joinWaitlist(ctx, P(2), { doctorId: w.kyivDoctors[0] as string, serviceId: w.c30, fromDate: workday(20), toDate: workday(22) }));
    expect(codeOf(await leaveWaitlist(ctx, P(3), e.id))).toBe('NOT_FOUND');
    expect(codeOf(await leaveWaitlist(ctx, P(2), e.id))).toBe('ok');
  });
  it('a request ending in the past is refused', async () => {
    expect(codeOf(await joinWaitlist(ctx, P(4), { doctorId: w.kyivDoctors[0] as string, serviceId: w.c30, fromDate: '2026-04-01', toDate: '2026-04-10' }))).toBe('BAD_USER_INPUT');
  });
});
void HOUR;
