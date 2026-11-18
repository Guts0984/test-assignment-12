import { z } from 'zod';
import { rulesEnvShape } from '@clinic/shared';

/**
 * API environment. Secrets (DATABASE_URL) have no default: the process fails fast at boot.
 * Everything non-secret has a safe default.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  COOKIE_SECURE: z.stringbool().default(false),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24 * 7),
  /** Comma separated origins allowed to call the API with cookies. */
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  /**
   * Comma separated CIDRs of reverse proxies whose X-Real-IP / X-Forwarded-For may be believed.
   * Empty (default): nobody; the socket address is the client address.
   */
  TRUST_PROXY_CIDRS: z.string().default(''),
  GQL_MAX_DEPTH: z.coerce.number().int().positive().default(10),
  GQL_MAX_COMPLEXITY: z.coerce.number().int().positive().default(2000),
  GQL_MAX_FIELDS: z.coerce.number().int().positive().default(400),
  BODY_LIMIT_KB: z.coerce.number().int().positive().default(100),
  RATE_GLOBAL_PER_MIN: z.coerce.number().int().positive().default(300),
  RATE_SIGNIN_PER_MIN: z.coerce.number().int().positive().default(5),
  RATE_SIGNIN_IP_PER_MIN: z.coerce.number().int().positive().default(20),
  RATE_SIGNUP_PER_HOUR: z.coerce.number().int().positive().default(5),
  RATE_HOLD_PER_MIN: z.coerce.number().int().positive().default(10),
  WS_MAX_CONN_PER_IP: z.coerce.number().int().positive().default(10),
  WS_MAX_SUBS_PER_CONN: z.coerce.number().int().positive().default(10),
  ARGON_MEMORY_KIB: z.coerce.number().int().min(1024).default(19_456),
  ARGON_TIME_COST: z.coerce.number().int().min(1).default(2),
  ...rulesEnvShape,
});

export type ApiEnv = z.infer<typeof schema>;

export const loadApiEnv = (source: NodeJS.ProcessEnv = process.env): ApiEnv => {
  const r = schema.safeParse(source);
  if (!r.success) {
    throw new Error(`Invalid environment: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return r.data;
};
