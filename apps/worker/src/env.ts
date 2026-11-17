import { z } from 'zod';
import { rulesEnvShape } from '@clinic/shared';

/** Worker environment. Secrets (DATABASE_URL) have no default: the process fails fast at boot. */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  MAIL_FROM: z.string().default('Clinic Network <no-reply@clinic.local>'),
  QUEUE_NAME: z.string().default('clinic-tasks'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
  /** How often the dispatcher re-copies due tasks from Postgres into Redis (the safety net). */
  WORKER_RECONCILE_MS: z.coerce.number().int().min(100).default(15_000),
  /** Tasks due within this window are put into Redis; later ones wait in Postgres. */
  WORKER_HORIZON_SECONDS: z.coerce.number().int().min(1).default(3600),
  WORKER_STALLED_INTERVAL_MS: z.coerce.number().int().min(500).default(30_000),
  WORKER_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(8),
  /** Failed tasks are retried with exponential backoff: base * 2^attempts, capped at 5 minutes. */
  WORKER_RETRY_BASE_MS: z.coerce.number().int().min(1).default(1000),
  /** TEST KNOB: sleep this long while holding the task lock, before doing the work. */
  WORKER_PROCESSING_DELAY_MS: z.coerce.number().int().min(0).default(0),
  ...rulesEnvShape,
});

export type WorkerEnv = z.infer<typeof schema>;

export const loadWorkerEnv = (source: NodeJS.ProcessEnv = process.env): WorkerEnv => {
  const r = schema.safeParse(source);
  if (!r.success) {
    throw new Error(`Invalid environment: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return r.data;
};
