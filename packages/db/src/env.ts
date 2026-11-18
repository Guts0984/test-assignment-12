import { z } from 'zod';

/** Env for the db CLIs (migrate, seed). Secrets have no defaults: the process fails fast. */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  /** Password given to every seeded account (demo logins listed in the README). */
  SEED_PASSWORD: z.string().min(8).optional(),
  SEED_ENABLED: z.stringbool().default(true),
  SEED_RNG: z.coerce.number().int().default(12345),
  SEED_DOCTORS: z.coerce.number().int().min(1).max(200).default(40),
  SEED_PATIENTS: z.coerce.number().int().min(10).default(20_000),
  SEED_APPOINTMENTS: z.coerce.number().int().min(10).default(150_000),
  /** Active waiting-list requests in the demo data (0 for end-to-end runs that need an empty queue). */
  SEED_WAITLIST_ENTRIES: z.coerce.number().int().min(0).default(250),
  SEED_PAST_DAYS: z.coerce.number().int().min(1).default(150),
  SEED_FUTURE_DAYS: z.coerce.number().int().min(1).default(30),
  /** Fixed "now" for reproducible seeds in tests; default is the real clock. */
  SEED_NOW: z.iso.datetime().optional(),
});

export type DbEnv = z.infer<typeof envSchema>;

export const loadDbEnv = (source: NodeJS.ProcessEnv = process.env): DbEnv => {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  return parsed.data;
};
