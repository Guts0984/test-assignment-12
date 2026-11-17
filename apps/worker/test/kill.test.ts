import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { sql } from 'drizzle-orm';
import path from 'node:path';
import { clearMails, count, createTestDb, insertTask, listMails, makeCtx, makeWorld, sleep, startWorker, taskRow, uniqueQueue, waitForMails, workerEnv, type TestDb, type World } from './helpers.js';
import { bookReal, realClock } from './support.js';

let t: TestDb;
let w: World;
let child: ChildProcess | undefined;

beforeAll(async () => {
  t = await createTestDb();
  w = await makeWorld(t.db);
});
afterAll(async () => {
  child?.kill('SIGKILL');
  await t.drop();
});
afterEach(() => {
  child?.kill('SIGKILL');
});

const spawnChild = (queue: string, env: Record<string, string>): ChildProcess =>
  spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      DATABASE_URL: t.url,
      REDIS_URL: inject('redisUrl'),
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(inject('smtpPort')),
      QUEUE_NAME: queue,
      WORKER_RECONCILE_MS: '300',
      WORKER_STALLED_INTERVAL_MS: '1000',
      ...env,
    },
    stdio: 'ignore',
  });

describe('a worker killed with SIGKILL in the middle of a task', () => {
  it('releases the task; another worker finishes it; the email is sent exactly once', async () => {
    await clearMails();
    const queue = uniqueQueue();
    const a = await bookReal(makeCtx(t.db, realClock), w, 0, 0, 5, '10:00', 'kill-1');
    const id = await insertTask(t.db, { kind: 'reminder.2h', runAt: new Date(Date.now() + 500), payload: { appointmentId: a.id, version: a.version, hours: 2 } });
    child = spawnChild(queue, { WORKER_PROCESSING_DELAY_MS: '6000' }); // sits inside the task, holding its row lock
    // wait until the child really holds the task's row lock (pending, yet not lockable by us)
    let locked = false;
    for (let i = 0; i < 80 && !locked; i++) {
      await sleep(250);
      const r = await t.db.execute(sql`SELECT (SELECT count(*) FROM scheduled_tasks WHERE id = ${id}::uuid AND status = 'pending')::int AS pending,
        (SELECT count(*) FROM (SELECT 1 FROM scheduled_tasks WHERE id = ${id}::uuid AND status = 'pending' FOR UPDATE SKIP LOCKED) x)::int AS free`);
      const row = r.rows[0] as { pending: number; free: number };
      locked = row.pending === 1 && row.free === 0;
    }
    expect(locked).toBe(true);
    child.kill('SIGKILL');
    await sleep(500);
    expect(await listMails()).toHaveLength(0); // it never got to send
    expect((await taskRow(t.db, id)).status).toBe('pending'); // and nothing was marked done
    const rescue = await startWorker(workerEnv(t.url, queue));
    try {
      const mails = await waitForMails(1, 30_000);
      await sleep(2000);
      expect(await listMails()).toHaveLength(1);
      expect(mails).toHaveLength(1);
      expect((await taskRow(t.db, id)).status).toBe('done');
      expect(await count(t.db, sql`SELECT count(*)::int AS n FROM notifications WHERE kind = 'reminder_2h' AND payload->>'appointmentId' = ${a.id}`)).toBe(1);
    } finally {
      await rescue.close();
    }
  });

  it('SIGTERM finishes the running task and exits cleanly', async () => {
    await clearMails();
    const queue = uniqueQueue();
    const a = await bookReal(makeCtx(t.db, realClock), w, 1, 1, 6, '10:00', 'kill-2');
    const id = await insertTask(t.db, { kind: 'reminder.2h', runAt: new Date(Date.now() + 300), payload: { appointmentId: a.id, version: a.version, hours: 2 } });
    child = spawnChild(queue, { WORKER_PROCESSING_DELAY_MS: '1500' });
    const exited = new Promise<number | null>((resolve) => child?.on('exit', (code) => resolve(code)));
    await sleep(3000); // task is in flight (started ~1 s in, takes 1.5 s)
    child.kill('SIGTERM');
    const code = await Promise.race([exited, sleep(15_000).then(() => 'timeout' as const)]);
    expect(code).not.toBe('timeout');
    await waitForMails(1, 15_000);
    expect(await listMails()).toHaveLength(1);
    expect((await taskRow(t.db, id)).status).toBe('done');
  });
});
