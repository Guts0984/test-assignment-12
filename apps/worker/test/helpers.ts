import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { inject } from 'vitest';
import { Redis } from 'ioredis';
import { NestFactory } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import type { Db } from '@clinic/db';
import { loadWorkerEnv, WorkerModule, type WorkerEnv } from '../src/index.js';

export * from './helpers-domain.js';

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const workerEnv = (
  dbUrl: string,
  queue: string,
  over: Record<string, string> = {},
): WorkerEnv =>
  loadWorkerEnv({
    DATABASE_URL: dbUrl,
    REDIS_URL: inject('redisUrl'),
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(inject('smtpPort')),
    QUEUE_NAME: queue,
    WORKER_RECONCILE_MS: '300',
    WORKER_STALLED_INTERVAL_MS: '1000',
    WORKER_RETRY_BASE_MS: '100',
    WORKER_CONCURRENCY: '4',
    ...over,
  });

export type RunningWorker = { close: () => Promise<void> };
export const startWorker = async (env: WorkerEnv): Promise<RunningWorker> => {
  const app = await NestFactory.createApplicationContext(WorkerModule.register(env), {
    logger: false,
  });
  return { close: () => app.close() };
};

export const uniqueQueue = (): string => `q-${randomUUID().slice(0, 8)}`;

// ---------- Mailpit ----------
type MailMsg = {
  ID: string;
  MessageID: string;
  Subject: string;
  To: { Address: string }[];
  Snippet: string;
};
export const listMails = async (): Promise<MailMsg[]> => {
  const r = await fetch(`${inject('mailUiUrl')}/api/v1/messages?limit=500`);
  return ((await r.json()) as { messages: MailMsg[] }).messages;
};
export const clearMails = async (): Promise<void> => {
  await fetch(`${inject('mailUiUrl')}/api/v1/messages`, { method: 'DELETE' });
};
export const mailBody = async (id: string): Promise<{ Text: string; HTML: string }> =>
  (await (await fetch(`${inject('mailUiUrl')}/api/v1/message/${id}`)).json()) as {
    Text: string;
    HTML: string;
  };
export const waitForMails = async (
  n: number,
  timeoutMs = 15_000,
  pred: (m: MailMsg) => boolean = () => true,
): Promise<MailMsg[]> => {
  const end = Date.now() + timeoutMs;
  let last: MailMsg[] = [];
  while (Date.now() < end) {
    last = (await listMails()).filter(pred);
    if (last.length >= n) return last;
    await sleep(100);
  }
  return last;
};

// ---------- Redis ----------
export const redisClient = (): Redis =>
  new Redis(inject('redisUrl'), { maxRetriesPerRequest: null });
export const flushRedis = async (): Promise<void> => {
  const r = redisClient();
  await r.flushall();
  r.disconnect();
};
export const dockerRun = (cmd: string, id: string): void => {
  execSync(`docker ${cmd} ${id}`, { stdio: 'ignore' });
};
export const restartRedis = async (): Promise<void> => {
  dockerRun('restart', inject('redisContainerId'));
  const end = Date.now() + 15_000;
  while (Date.now() < end) {
    try {
      const r = redisClient();
      await r.ping();
      r.disconnect();
      return;
    } catch {
      await sleep(200);
    }
  }
};

// ---------- ledger ----------
export const insertTask = async (
  db: Db,
  t: { kind: string; runAt: Date; payload: Record<string, unknown>; key?: string },
): Promise<string> => {
  const r = await db.execute(sql`
    INSERT INTO scheduled_tasks (kind, run_at, payload, dedupe_key)
    VALUES (${t.kind}, ${t.runAt.toISOString()}::timestamptz, ${JSON.stringify(t.payload)}::jsonb, ${t.key ?? randomUUID()})
    RETURNING id`);
  return (r.rows[0] as { id: string }).id;
};
export const taskRow = async (db: Db, id: string) =>
  (
    await db.execute(
      sql`SELECT status, attempts, last_error FROM scheduled_tasks WHERE id = ${id}::uuid`,
    )
  ).rows[0] as { status: string; attempts: number; last_error: string | null };
