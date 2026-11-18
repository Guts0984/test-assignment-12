import {
  Inject,
  Injectable,
  Module,
  type DynamicModule,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';
import pg from 'pg';
import { createDb, createPool } from '@clinic/db';
import { rulesFromEnv } from '@clinic/shared';
import type { WorkerEnv } from './env.js';
import { createMailer, type Mailer } from './mail.js';
import { processTask, publishToRedis, type WorkerDeps } from './handlers.js';

export const ENV = Symbol('WORKER_ENV');
export const DEPS = Symbol('WORKER_DEPS');
export const REDIS_CONN = Symbol('REDIS_CONN');

const log = (msg: string, extra?: Record<string, unknown>): void => {
  console.log(JSON.stringify({ at: new Date().toISOString(), svc: 'worker', msg, ...extra }));
};

const bullConnection = (url: string, opts: { failFast?: boolean } = {}): ConnectionOptions => {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    // the worker must survive Redis being down or flushed: never give up reconnecting
    maxRetriesPerRequest: null,
    retryStrategy: (times: number) => Math.min(times * 200, 2000),
    // producers (the dispatcher) fail at once while Redis is down instead of queueing forever;
    // the next reconcile simply tries again. Consumers keep their offline queue.
    ...(opts.failFast ? { enableOfflineQueue: false } : {}),
  };
};

const timeout = (ms: number): Promise<'timeout'> =>
  new Promise((r) => setTimeout(() => r('timeout'), ms).unref());

/**
 * Shutdown must never hang on a dead Redis or a stuck connection: wait politely, then force, and
 * in the end give up waiting (the process is exiting anyway). Every step is bounded.
 */
const closeWithin = async (
  ms: number,
  graceful: () => Promise<unknown>,
  force: () => Promise<unknown>,
): Promise<void> => {
  const r = await Promise.race([
    graceful().then(
      () => 'ok' as const,
      () => 'ok' as const,
    ),
    timeout(ms),
  ]);
  if (r === 'timeout')
    await Promise.race([
      force().then(
        () => undefined,
        () => undefined,
      ),
      timeout(2000),
    ]);
};

/**
 * Copies due tasks from Postgres into Redis. Redis only ever holds a *schedule*; losing it loses
 * nothing, because every `reconcileMs` (and at boot, and on NOTIFY) the still-pending tasks are
 * added again under their task id as job id (adding an existing job is a no-op).
 */
@Injectable()
export class Dispatcher implements OnModuleInit, OnModuleDestroy {
  private queue!: Queue;
  private timer: NodeJS.Timeout | undefined;
  private listener: pg.Client | undefined;
  private closed = false;
  private running = false;
  private again = false;

  constructor(
    @Inject(ENV) private readonly env: WorkerEnv,
    @Inject(DEPS) private readonly deps: WorkerDeps,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(this.env.QUEUE_NAME, {
      connection: bullConnection(this.env.REDIS_URL, { failFast: true }),
    });
    this.queue.on('error', (e) => log('queue error', { error: e.message }));
    // never block startup on Redis: the worker must come up (and keep retrying) while it is down
    void this.reconcile();
    this.timer = setInterval(() => void this.reconcile(), this.env.WORKER_RECONCILE_MS);
    void this.listen();
  }

  /** Enqueue everything pending and due within the horizon. Safe to call concurrently and repeatedly. */
  async reconcile(): Promise<number> {
    if (this.closed) return 0;
    if (this.running) {
      this.again = true;
      return 0;
    }
    this.running = true;
    let added = 0;
    try {
      do {
        this.again = false;
        const now = this.deps.now();
        const horizon = new Date(now.getTime() + this.env.WORKER_HORIZON_SECONDS * 1000);
        const r = await this.deps.pool.query(
          `SELECT id, kind, run_at, attempts FROM scheduled_tasks
           WHERE status = 'pending' AND run_at <= $1 AND attempts < $2 ORDER BY run_at LIMIT 2000`,
          [horizon, this.env.WORKER_MAX_ATTEMPTS],
        );
        for (const t of r.rows as { id: string; kind: string; run_at: Date; attempts: number }[]) {
          // a task that already failed waits longer each time, so an outage cannot burn all attempts
          const backoff =
            t.attempts === 0
              ? 0
              : Math.min(this.env.WORKER_RETRY_BASE_MS * 2 ** t.attempts, 300_000);
          const delay = Math.max(0, new Date(t.run_at).getTime() + backoff - now.getTime());
          await this.queue.add(
            t.kind,
            { taskId: t.id },
            { jobId: t.id, delay, removeOnComplete: true, removeOnFail: true, attempts: 1 },
          );
          added++;
        }
      } while (this.again && !this.closed);
    } catch (e) {
      // Redis or Postgres is down right now: the next tick retries
      log('reconcile failed', { error: String(e) });
    } finally {
      this.running = false;
    }
    return added;
  }

  private async listen(): Promise<void> {
    while (!this.closed) {
      const c = new pg.Client({ connectionString: this.env.DATABASE_URL });
      this.listener = c;
      try {
        c.on('notification', () => void this.reconcile());
        await c.connect();
        await c.query('LISTEN scheduled_tasks');
        await new Promise<void>((resolve) => {
          c.on('error', () => resolve());
          c.on('end', () => resolve());
        });
      } catch (e) {
        log('listener error', { error: String(e) });
      } finally {
        await c.end().catch(() => undefined);
      }
      if (!this.closed) await new Promise((r) => setTimeout(r, 1000));
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    await this.listener?.end().catch(() => undefined);
    await closeWithin(
      3000,
      () => this.queue.close(),
      () => this.queue.disconnect(),
    );
  }
}

/** Takes jobs out of Redis and runs them through `processTask`. Run as many copies as you like. */
@Injectable()
export class Consumer implements OnModuleInit, OnModuleDestroy {
  private worker!: Worker;

  constructor(
    @Inject(ENV) private readonly env: WorkerEnv,
    @Inject(DEPS) private readonly deps: WorkerDeps,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker(
      this.env.QUEUE_NAME,
      async (job) => {
        const taskId = String((job.data as { taskId?: unknown }).taskId ?? '');
        const outcome = await processTask(this.deps, taskId);
        return outcome;
      },
      {
        connection: bullConnection(this.env.REDIS_URL),
        concurrency: this.env.WORKER_CONCURRENCY,
        stalledInterval: this.env.WORKER_STALLED_INTERVAL_MS,
        lockDuration: Math.max(this.env.WORKER_STALLED_INTERVAL_MS, 5_000),
      },
    );
    this.worker.on('error', (e) => log('worker error', { error: e.message }));
    this.worker.on('completed', (job, outcome) =>
      log('task processed', {
        taskId: (job.data as { taskId?: string }).taskId,
        kind: job.name,
        outcome,
      }),
    );
    this.worker.on('failed', (job, e) => log('task failed', { jobId: job?.id, error: e.message }));
  }

  async onModuleDestroy(): Promise<void> {
    // active jobs get 10 s to finish (their row locks are released if they do not); then force
    await closeWithin(
      10_000,
      () => this.worker.close(),
      () => this.worker.close(true),
    );
  }
}

@Module({})
export class WorkerModule {
  static register(env: WorkerEnv, overrides: { now?: () => Date } = {}): DynamicModule {
    const pool = createPool(env.DATABASE_URL, env.WORKER_CONCURRENCY * 2 + 6, (e) =>
      log('db idle error', { error: e.message }),
    );
    const mailer: Mailer = createMailer({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      from: env.MAIL_FROM,
    });
    const publisher = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (n) => Math.min(n * 200, 2000),
    });
    publisher.on('error', () => undefined); // best-effort channel; failures are logged at publish time
    const now = overrides.now ?? (() => new Date());
    const deps: WorkerDeps = {
      pool,
      domain: { db: createDb(pool), now, rules: rulesFromEnv(env) },
      mailer,
      publish: publishToRedis(publisher),
      now,
      processingDelayMs: env.WORKER_PROCESSING_DELAY_MS,
      maxAttempts: env.WORKER_MAX_ATTEMPTS,
      log,
    };
    return {
      module: WorkerModule,
      providers: [
        { provide: ENV, useValue: env },
        { provide: DEPS, useValue: deps },
        {
          provide: REDIS_CONN,
          useValue: {
            close: async () => {
              publisher.disconnect();
              mailer.close();
              await Promise.race([pool.end().catch(() => undefined), timeout(3000)]);
            },
          },
        },
        Dispatcher,
        Consumer,
        {
          provide: 'CLEANUP',
          useFactory: (c: { close: () => Promise<void> }) => ({ onModuleDestroy: () => c.close() }),
          inject: [REDIS_CONN],
        },
      ],
    };
  }
}
