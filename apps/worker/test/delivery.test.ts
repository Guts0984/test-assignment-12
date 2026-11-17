import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import { inject } from 'vitest';
import { cancelAppointment, rescheduleAppointment } from '@clinic/domain';
import {
  clearMails, createTestDb, flushRedis, insertTask, listMails, makeCtx, makeWorld, must, redisClient, restartRedis, rows, sleep, startWorker, taskRow,
  uniqueQueue, waitForMails, workerEnv, at, dockerRun, mailBody, type RunningWorker, type TestDb, type World, count,
} from './helpers.js';
import { bookReal, futureWorkday, realClock } from './support.js';

let t: TestDb;
let w: World;
let queue: string;
let running: RunningWorker[] = [];
const ctx = () => makeCtx(t.db, realClock);

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
  await t.db.execute(sql`DELETE FROM scheduled_tasks`);
  // earlier tests deliberately corrupt some patients (no email, hostile name): restore them
  await t.db.execute(sql`UPDATE patients p SET email = u.email, full_name = 'Patient' FROM users u WHERE u.id = p.user_id`);
});
afterEach(async () => {
  await Promise.all(running.map((r) => r.close()));
  running = [];
});

const spawn = async (over: Record<string, string> = {}, q = queue): Promise<RunningWorker> => {
  const r = await startWorker(workerEnv(t.url, q, over));
  running.push(r);
  return r;
};
const inMs = (ms: number): Date => new Date(Date.now() + ms);

const reminder = (appointmentId: string, version: number, ms: number, hours: 24 | 2 = 2) =>
  insertTask(t.db, { kind: `reminder.${hours}h`, runAt: inMs(ms), payload: { appointmentId, version, hours } });

describe('a due task becomes exactly one email, on time', () => {
  it('reminder: nothing before the time, one email after, task done, in-app notification written', async () => {
    const a = await bookReal(ctx(), w, 0, 0, 0, '10:00', 'k-a1');
    const id = await reminder(a.id, a.version, 2000);
    await spawn();
    await sleep(1200);
    expect(await listMails()).toHaveLength(0); // not early
    const mails = await waitForMails(1, 8000);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.To[0]?.Address).toBe('p0@t.io');
    expect(mails[0]?.MessageID).toBe(`${id}@clinic.local`);
    expect(mails[0]?.Subject).toContain('Нагадування');
    expect(mails[0]?.Subject).toContain('10:00'); // clinic wall clock, not the server's
    await sleep(1500);
    expect(await listMails()).toHaveLength(1); // and never again
    expect((await taskRow(t.db, id)).status).toBe('done');
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM notifications WHERE kind = 'reminder_2h' AND payload->>'appointmentId' = ${a.id}`)).toBe(1);
  });

  it('after a reschedule only the new time is reminded; after a cancel nothing is', async () => {
    const a = await bookReal(ctx(), w, 1, 1, 1, '10:00', 'k-b1');
    const moved = must(await rescheduleAppointment(ctx(), (w.patients[1] as World['patients'][number]).actor, { appointmentId: a.id, newStartsAt: at(futureWorkday(2), '11:00') }));
    // pull the (new) reminders into the next few seconds
    await t.db.execute(sql`UPDATE scheduled_tasks SET run_at = now() + interval '1 second' WHERE status = 'pending' AND kind LIKE 'reminder.%' AND payload->>'appointmentId' = ${a.id}`);
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM scheduled_tasks WHERE status = 'cancelled' AND kind LIKE 'reminder.%' AND payload->>'appointmentId' = ${a.id}`)).toBe(2);
    // a stale task of the old version that somehow survived must still not fire
    const stale = await reminder(a.id, 1, 1000, 24);
    await spawn();
    const mails = await waitForMails(2, 10_000);
    await sleep(1500);
    const all = await listMails();
    expect(all.length).toBe(2);
    for (const m of all) expect(m.Subject).toContain('11:00');
    expect(all.some((m) => m.Subject.includes('10:00'))).toBe(false);
    expect((await taskRow(t.db, stale)).status).toBe('cancelled');
    void mails; void moved;

    await clearMails();
    const b = await bookReal(ctx(), w, 2, 2, 3, '10:00', 'k-b2');
    must(await cancelAppointment(ctx(), (w.patients[2] as World['patients'][number]).actor, { appointmentId: b.id }));
    await t.db.execute(sql`UPDATE scheduled_tasks SET run_at = now() + interval '1 second' WHERE kind LIKE 'reminder.%' AND payload->>'appointmentId' = ${b.id}`);
    const late = await reminder(b.id, b.version, 1000);
    await sleep(3500);
    expect((await listMails()).filter((m) => m.To[0]?.Address === 'p2@t.io' && m.Subject.includes('Нагадування'))).toHaveLength(0);
    expect((await taskRow(t.db, late)).status).toBe('cancelled');
  });

  it('a patient without an email address still gets the in-app reminder and nothing breaks', async () => {
    const a = await bookReal(ctx(), w, 3, 3, 4, '10:00', 'k-c1');
    await t.db.execute(sql`UPDATE patients SET email = NULL WHERE id = ${a.patientId}::uuid`);
    const id = await reminder(a.id, a.version, 500);
    await spawn();
    await sleep(2500);
    expect((await taskRow(t.db, id)).status).toBe('done');
    expect(await listMails()).toHaveLength(0);
  });

  it('hostile patient data cannot inject headers or markup', async () => {
    const a = await bookReal(ctx(), w, 4, 4, 5, '10:00', 'k-d1');
    await t.db.execute(sql`UPDATE patients SET full_name = ${'Eve <script>alert(1)</script>\r\nBcc: victim@evil.io'} WHERE id = ${a.patientId}::uuid`);
    await reminder(a.id, a.version, 300);
    await spawn();
    const [m] = await waitForMails(1, 8000);
    expect(m?.Subject).not.toMatch(/[\r\n]/);
    const body = await mailBody(m?.ID as string);
    expect(body.HTML).not.toContain('<script>');
    expect(body.HTML).toContain('&lt;script&gt;');
    expect((m?.To ?? []).map((x) => x.Address)).toEqual(['p4@t.io']);
    // an address that could smuggle recipients is simply not mailed
    await clearMails();
    await t.db.execute(sql`UPDATE patients SET email = ${'a@b.io>\r\nBcc: victim@evil.io'} WHERE id = ${a.patientId}::uuid`);
    const id2 = await reminder(a.id, a.version, 300);
    await sleep(2500);
    expect(await listMails()).toHaveLength(0);
    expect((await taskRow(t.db, id2)).status).toBe('done');
  });
});

describe('Redis loss loses nothing (invariant 9)', () => {
  it('FLUSHALL while tasks are scheduled in Redis: all are still delivered, once', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const a = await bookReal(ctx(), w, 10 + i, i % 5, 6 + i, '10:00', `k-f${i}`);
      ids.push(await reminder(a.id, a.version, 3500, 2));
    }
    await spawn();
    await sleep(900); // dispatched: sitting in Redis as delayed jobs
    const r = redisClient();
    expect(await r.zcard(`bull:${queue}:delayed`)).toBe(6); // all six really sit in Redis
    await flushRedis();
    r.disconnect();
    const mails = await waitForMails(6, 12_000);
    await sleep(1500);
    expect(await listMails()).toHaveLength(6);
    expect(new Set((await listMails()).map((m) => m.MessageID)).size).toBe(6);
    expect(mails.length).toBe(6);
    for (const id of ids) expect((await taskRow(t.db, id)).status).toBe('done');
  });

  it('Redis restarted empty, then the worker restarted: tasks still arrive on time, no duplicates', async () => {
    const a = await bookReal(ctx(), w, 20, 0, 12, '10:00', 'k-g1');
    const id = await reminder(a.id, a.version, 9000);
    const w1 = await spawn();
    await sleep(800);
    await restartRedis(); // everything gone
    await w1.close();
    running = [];
    await spawn();
    expect(await listMails()).toHaveLength(0);
    const mails = await waitForMails(1, 15_000);
    await sleep(1500);
    expect(await listMails()).toHaveLength(1);
    expect(mails).toHaveLength(1);
    expect((await taskRow(t.db, id)).status).toBe('done');
  });

  it('the worker may start while Redis is down and picks up once it is back', async () => {
    const a = await bookReal(ctx(), w, 21, 1, 13, '10:00', 'k-h1');
    const id = await reminder(a.id, a.version, 1500);
    dockerRun('stop', inject('redisContainerId'));
    await spawn().catch(() => undefined);
    await sleep(2500);
    expect(await listMails()).toHaveLength(0);
    dockerRun('start', inject('redisContainerId'));
    const mails = await waitForMails(1, 20_000);
    expect(mails).toHaveLength(1);
    await sleep(1000);
    expect(await listMails()).toHaveLength(1);
    expect((await taskRow(t.db, id)).status).toBe('done');
  });
});

describe('several workers (invariant 10, acceptance 11)', () => {
  it('3 workers, 36 tasks, plus duplicate jobs injected by hand: every email exactly once', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 36; i++) {
      const a = await bookReal(ctx(), w, i, i % 6, 14 + Math.floor(i / 6), ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00'][i % 6] as string, `k-m${i}`);
      ids.push(await reminder(a.id, a.version, 1500 + (i % 6) * 200, i % 2 === 0 ? 2 : 24));
    }
    await Promise.all([spawn(), spawn(), spawn()]);
    const q = new Queue(queue, { connection: { host: new URL(inject('redisUrl')).hostname, port: Number(new URL(inject('redisUrl')).port) } });
    // poison the queue with duplicates: the same task id under other job ids, many times
    for (const id of ids.slice(0, 12)) for (let d = 0; d < 5; d++) await q.add('reminder.2h', { taskId: id }, { jobId: `dup-${id}-${d}`, delay: 1000 + d * 150 });
    const mails = await waitForMails(36, 25_000);
    await sleep(3000);
    const notDone = await rows<{ status: string; attempts: number; last_error: string | null }>(t.db, sql`SELECT status, attempts, last_error FROM scheduled_tasks WHERE status <> 'done' AND id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`);
    expect(notDone, JSON.stringify(notDone)).toEqual([]);
    const all = await listMails();
    expect(mails.length).toBeGreaterThanOrEqual(36);
    expect(all).toHaveLength(36);
    expect(new Set(all.map((m) => m.MessageID)).size).toBe(36);
    for (const id of ids) expect((await taskRow(t.db, id)).status).toBe('done');
    await q.close();
  });

  it('two workers racing on the same fresh task: the row lock admits one', async () => {
    const a = await bookReal(ctx(), w, 37, 2, 20, '10:00', 'k-n1');
    for (let round = 0; round < 8; round++) {
      await insertTask(t.db, { kind: 'email.booking_confirmed', runAt: new Date(), payload: { appointmentId: a.id }, key: `race-${round}` });
    }
    await Promise.all([spawn({ WORKER_PROCESSING_DELAY_MS: '200' }), spawn({ WORKER_PROCESSING_DELAY_MS: '200' }), spawn({ WORKER_PROCESSING_DELAY_MS: '200' })]);
    await waitForMails(8, 15_000);
    await sleep(2000);
    expect(await listMails()).toHaveLength(8);
    expect(new Set((await listMails()).map((m) => m.MessageID)).size).toBe(8);
  });
});

describe('failures and poison', () => {
  it('SMTP down: nothing is lost and nothing is lost to a retry storm; once it is back the email arrives once', async () => {
    const a = await bookReal(ctx(), w, 30, 3, 21, '10:00', 'k-s1');
    const id = await reminder(a.id, a.version, 300);
    dockerRun('stop', inject('mailContainerId'));
    await spawn();
    await sleep(3000);
    const mid = await taskRow(t.db, id);
    expect(mid.status).toBe('pending');
    expect(mid.attempts).toBeGreaterThanOrEqual(1);
    expect(mid.attempts).toBeLessThan(8); // backoff keeps the retries from burning every attempt
    dockerRun('start', inject('mailContainerId'));
    await sleep(1500);
    const mails = await waitForMails(1, 30_000);
    await sleep(1500);
    expect(await listMails()).toHaveLength(1);
    expect(mails).toHaveLength(1);
    expect((await taskRow(t.db, id)).status).toBe('done');
  });

  it('a poison task (unknown kind, malformed id) is retried a bounded number of times and never blocks the others', async () => {
    const a = await bookReal(ctx(), w, 31, 4, 22, '10:00', 'k-p1');
    const p1 = await insertTask(t.db, { kind: 'does.not.exist', runAt: new Date(), payload: {} });
    const p2 = await insertTask(t.db, { kind: 'reminder.2h', runAt: new Date(), payload: { appointmentId: "x'; DROP TABLE appointments;--", version: 1 } });
    const good = await reminder(a.id, a.version, 800);
    await spawn({ WORKER_MAX_ATTEMPTS: '3' });
    await waitForMails(1, 10_000);
    await sleep(4000);
    expect((await taskRow(t.db, good)).status).toBe('done');
    for (const id of [p1, p2]) {
      const r = await taskRow(t.db, id);
      expect(r.status).toBe('pending');
      expect(r.attempts).toBe(3); // gave up exactly at the cap
      expect(r.last_error).toBeTruthy();
    }
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM appointments`)).toBeGreaterThan(0);
  });

  it('tasks beyond the horizon stay in Postgres until they come into range', async () => {
    const a = await bookReal(ctx(), w, 32, 5, 23, '10:00', 'k-q1');
    const id = await reminder(a.id, a.version, 2 * 3600_000);
    await spawn({ WORKER_HORIZON_SECONDS: '60' });
    await sleep(1200);
    const q = new Queue(queue, { connection: { host: new URL(inject('redisUrl')).hostname, port: Number(new URL(inject('redisUrl')).port) } });
    expect((await q.getJobCounts('delayed', 'waiting', 'active')).delayed).toBe(0);
    await t.db.execute(sql`UPDATE scheduled_tasks SET run_at = now() + interval '1 second' WHERE id = ${id}::uuid`);
    const mails = await waitForMails(1, 10_000);
    expect(mails).toHaveLength(1);
    await q.close();
  });
});

void rows;
