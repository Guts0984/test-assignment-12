import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  cancelAppointment,
  getAvailability,
  holdSlot,
  joinWaitlist,
  markDoctorSick,
  confirmBooking,
} from '@clinic/domain';
import { decodeEvent, EVENTS_CHANNEL, type ClinicEvent } from '@clinic/shared';
import {
  at,
  clearMails,
  count,
  createTestDb,
  flushRedis,
  listMails,
  makeCtx,
  makeWorld,
  must,
  redisClient,
  rows,
  sleep,
  startWorker,
  uniqueQueue,
  waitForMails,
  workerEnv,
  type RunningWorker,
  type TestDb,
  type World,
} from './helpers.js';
import { bookReal, futureWorkday, realClock } from './support.js';

let t: TestDb;
let w: World;
let queue: string;
let running: RunningWorker[] = [];
// short real-time TTLs: holds live 2 s, offers 2 s
const ctx = () => makeCtx(t.db, realClock, { holdTtlSeconds: 2, offerTtlSeconds: 2 });
const P = (i: number) => (w.patients[i] as World['patients'][number]).actor;

beforeAll(async () => {
  t = await createTestDb(60);
  w = await makeWorld(t.db);
});
afterAll(async () => {
  await t.drop();
});
beforeEach(async () => {
  await clearMails();
  queue = uniqueQueue();
});
afterEach(async () => {
  await Promise.all(running.map((r) => r.close()));
  running = [];
});
const spawn = async (over: Record<string, string> = {}): Promise<RunningWorker> => {
  const r = await startWorker(
    workerEnv(t.url, queue, { HOLD_TTL_SECONDS: '2', OFFER_TTL_SECONDS: '2', ...over }),
  );
  running.push(r);
  return r;
};
const slot = (doctor: number, day: number, time: string) => ({
  clinicId: w.kyiv,
  doctorId: w.kyivDoctors[doctor] as string,
  serviceId: w.c30,
  startsAt: at(futureWorkday(day), time),
});
const status = async (id: string): Promise<string> =>
  String(
    (
      (
        await rows<{ status: string }>(
          t.db,
          sql`SELECT status FROM appointments WHERE id = ${id}::uuid`,
        )
      )[0] as { status: string }
    ).status,
  );
const visible = async (doctor: number, day: number, startsAt: Date): Promise<boolean> => {
  const g = must(
    await getAvailability(ctx(), {
      clinicId: w.kyiv,
      serviceId: w.c30,
      doctorId: w.kyivDoctors[doctor] as string,
      fromDate: futureWorkday(day),
      days: 1,
    }),
  );
  return g.slots.some((s) => s.startsAt.getTime() === startsAt.getTime());
};

describe('unconfirmed holds are released on time (acceptance 6, invariant 4)', () => {
  it('after 2 s the worker cancels the hold, tells subscribers, and the time is bookable again', async () => {
    await spawn();
    const sub = redisClient();
    const events: ClinicEvent[] = [];
    await sub.subscribe(EVENTS_CHANNEL);
    sub.on('message', (_c, m) => {
      const e = decodeEvent(m);
      if (e) events.push(e);
    });
    const r = slot(0, 30, '10:00');
    const h = must(await holdSlot(ctx(), P(0), r));
    expect(await visible(0, 30, r.startsAt)).toBe(false);
    await sleep(1000);
    expect(await status(h.id)).toBe('held');
    for (let i = 0; i < 40 && (await status(h.id)) === 'held'; i++) await sleep(150);
    expect(await status(h.id)).toBe('cancelled');
    expect(await visible(0, 30, r.startsAt)).toBe(true);
    const ev = await rows<{ actor_role: string; reason: string }>(
      t.db,
      sql`SELECT actor_role, reason FROM appointment_events WHERE appointment_id = ${h.id}::uuid AND type = 'cancelled'`,
    );
    expect(ev).toEqual([{ actor_role: 'system', reason: 'hold_expired' }]);
    await sleep(300);
    expect(events.some((e) => e.type === 'availability' && e.doctorId === r.doctorId)).toBe(true);
    // a late confirm is refused
    expect(
      (await confirmBooking(ctx(), P(0), { appointmentId: h.id, idempotencyKey: 'late-confirm-1' }))
        .ok,
    ).toBe(false);
    sub.disconnect();
  });

  it('Redis wiped right after the hold and the worker restarted: still released on time, nothing duplicated', async () => {
    const w1 = await spawn();
    const r = slot(1, 31, '10:00');
    const h = must(await holdSlot(ctx(), P(1), r));
    await sleep(500);
    await flushRedis();
    await w1.close();
    running = [];
    await spawn();
    expect(await status(h.id)).toBe('held');
    for (let i = 0; i < 60 && (await status(h.id)) === 'held'; i++) await sleep(150);
    expect(await status(h.id)).toBe('cancelled');
    expect(
      await count(
        t.db,
        sql`SELECT count(*)::int AS n FROM appointment_events WHERE appointment_id = ${h.id}::uuid AND type = 'cancelled'`,
      ),
    ).toBe(1);
    expect(
      await count(
        t.db,
        sql`SELECT count(*)::int AS n FROM scheduled_tasks WHERE kind = 'hold.expire' AND payload->>'appointmentId' = ${h.id} AND status = 'done'`,
      ),
    ).toBe(1);
  });

  it('with no worker at all the time is still free (the database does not need the worker for correctness)', async () => {
    const r = slot(2, 32, '10:00');
    const h = must(await holdSlot(ctx(), P(2), r));
    await sleep(2300);
    expect(await visible(2, 32, r.startsAt)).toBe(true);
    must(await holdSlot(ctx(), P(3), r)); // someone else takes it
    expect(await status(h.id)).toBe('cancelled');
  });

  it('a confirmed booking is never touched by its old expiry task', async () => {
    await spawn();
    const r = slot(3, 33, '10:00');
    const h = must(await holdSlot(ctx(), P(4), r));
    must(await confirmBooking(ctx(), P(4), { appointmentId: h.id, idempotencyKey: 'keep-1' }));
    await sleep(3500);
    expect(await status(h.id)).toBe('booked');
  });
});

describe('waiting list over time (acceptance 8)', () => {
  it('first does not answer for 15 (here 2) seconds: the offer moves to the second; the time is never visible as free', async () => {
    const a = await bookReal(ctx(), w, 10, 4, 34, '10:00', 'wl-a');
    const startsAt = a.startsAt;
    must(
      await joinWaitlist(ctx(), P(11), {
        doctorId: a.doctorId,
        serviceId: w.c30,
        fromDate: futureWorkday(34),
        toDate: futureWorkday(36),
      }),
    );
    await sleep(20);
    must(
      await joinWaitlist(ctx(), P(12), {
        doctorId: a.doctorId,
        serviceId: w.c30,
        fromDate: futureWorkday(34),
        toDate: futureWorkday(36),
      }),
    );
    await sleep(20);
    must(
      await joinWaitlist(ctx(), P(13), {
        doctorId: a.doctorId,
        serviceId: w.c30,
        fromDate: futureWorkday(34),
        toDate: futureWorkday(36),
      }),
    );
    await spawn();
    must(await cancelAppointment(ctx(), P(10), { appointmentId: a.id }));
    let everVisible = false;
    const end = Date.now() + 6500;
    const seen = new Set<string>();
    while (Date.now() < end) {
      const pending = () =>
        count(
          t.db,
          sql`SELECT count(*)::int AS n FROM waitlist_offers o JOIN appointments a ON a.id = o.appointment_id WHERE a.doctor_id = ${a.doctorId}::uuid AND a.starts_at = ${startsAt.toISOString()}::timestamptz AND o.status = 'pending'`,
        );
      const before = await pending();
      const vis = await visible(4, 34, startsAt);
      const after = await pending();
      // while an offer is open before AND after the look, the time must not have been visible
      if (vis && before > 0 && after > 0) everVisible = true;
      const o = await rows<{ patient_id: string; status: string }>(
        t.db,
        sql`SELECT a.patient_id, o.status FROM waitlist_offers o JOIN appointments a ON a.id = o.appointment_id WHERE a.doctor_id = ${a.doctorId}::uuid AND a.starts_at = ${startsAt.toISOString()}::timestamptz`,
      );
      for (const x of o) seen.add(`${x.patient_id}:${x.status}`);
      // never two live offers for one time
      expect(o.filter((x) => x.status === 'pending').length).toBeLessThanOrEqual(1);
      await sleep(100);
    }
    expect(everVisible).toBe(false);
    const p = (i: number) => (w.patients[i] as World['patients'][number]).id;
    expect(seen.has(`${p(11)}:pending`)).toBe(true);
    expect(seen.has(`${p(11)}:expired`)).toBe(true);
    expect(seen.has(`${p(12)}:pending`)).toBe(true);
    expect(seen.has(`${p(12)}:expired`)).toBe(true);
    expect(seen.has(`${p(13)}:pending`)).toBe(true);
    // each offer produced exactly one email, to the right person
    const mails = await waitForMails(3, 10_000, (m) => m.Subject.includes('Звільнився'));
    await sleep(1500);
    const offers = (await listMails()).filter((m) => m.Subject.includes('Звільнився'));
    expect(offers.map((m) => m.To[0]?.Address).sort()).toEqual([
      'p11@t.io',
      'p12@t.io',
      'p13@t.io',
    ]);
    void mails;
  });
});

describe('sick day emails (acceptance 13)', () => {
  it('12 visits, 3 workers, marked twice: 12 emails, once each', async () => {
    const times = [
      '09:00',
      '09:30',
      '10:00',
      '10:30',
      '11:00',
      '11:30',
      '12:00',
      '12:30',
      '14:00',
      '14:30',
      '15:00',
      '15:30',
    ];
    const q15 = w.q15;
    for (const [i, tm] of times.entries()) {
      const actor = P(20 + i);
      const h = must(
        await holdSlot(makeCtx(t.db, realClock), actor, {
          clinicId: w.kyiv,
          doctorId: w.kyivDoctors[5] as string,
          serviceId: q15,
          startsAt: at(futureWorkday(27), tm),
        }),
      );
      must(
        await confirmBooking(makeCtx(t.db, realClock), actor, {
          appointmentId: h.id,
          idempotencyKey: `sick-${i}`,
        }),
      );
    }
    await clearMails(); // booking confirmations are not what we count
    await t.db.execute(
      sql`UPDATE scheduled_tasks SET status = 'cancelled' WHERE kind = 'email.booking_confirmed'`,
    );
    await Promise.all([spawn(), spawn(), spawn()]);
    const mk = () =>
      markDoctorSick(makeCtx(t.db, realClock), w.registrar.kyiv, {
        doctorId: w.kyivDoctors[5] as string,
        localDate: futureWorkday(27),
      });
    expect(must(await mk()).cancelled).toBe(12);
    const sickMails = await waitForMails(12, 20_000, (m) => m.Subject.includes('лікар хворіє'));
    expect(sickMails).toHaveLength(12);
    must(await mk());
    await sleep(2500);
    const all = (await listMails()).filter((m) => m.Subject.includes('лікар хворіє'));
    expect(all).toHaveLength(12);
    expect(new Set(all.map((m) => m.To[0]?.Address)).size).toBe(12);
    expect(new Set(all.map((m) => m.MessageID)).size).toBe(12);
  });
});
