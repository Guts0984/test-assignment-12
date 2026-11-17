import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Anything that can run a query: the pool-backed db or an open transaction. */
export type Queryable = Db | Tx;

/**
 * An idle pooled connection can be killed by the server (restart, failover). pg emits that as an
 * 'error' event on the pool, and an unhandled one would crash the whole process, so it is
 * always handled: the broken client is discarded and the pool reconnects on next use.
 */
export const createPool = (
  connectionString: string,
  max = 10,
  onIdleError: (e: Error) => void = (e) => console.error('[db] idle client error:', e.message),
): pg.Pool => {
  const pool = new pg.Pool({ connectionString, max });
  pool.on('error', onIdleError);
  return pool;
};

export const createDb = (pool: pg.Pool): Db => drizzle(pool, { schema });

export type Actor = {
  readonly userId: string | null;
  readonly role: 'patient' | 'registrar' | 'doctor' | 'manager' | 'system';
};

export type ActorContext = {
  readonly actor: Actor;
  /** Injected clock; the history trigger stamps events with it. */
  readonly now?: Date;
  readonly reason?: string;
  readonly late?: boolean;
};

/**
 * Binds actor, clock and reason to the current transaction (set_config(..., true)).
 * The appointment history trigger reads them, so no code path can write history without it.
 */
export const setActorContext = async (tx: Queryable, ctx: ActorContext): Promise<void> => {
  await tx.execute(sql`
    SELECT set_config('app.actor_user_id', ${ctx.actor.userId ?? ''}, true),
           set_config('app.actor_role', ${ctx.actor.role}, true),
           set_config('app.now', ${ctx.now ? ctx.now.toISOString() : ''}, true),
           set_config('app.reason', ${ctx.reason ?? ''}, true),
           set_config('app.late', ${ctx.late ? 'true' : 'false'}, true)`);
};

/** Runs `fn` in a transaction with the actor context already bound. */
export const withActorTx = <T>(
  db: Db,
  ctx: ActorContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> =>
  db.transaction(async (tx) => {
    await setActorContext(tx, ctx);
    return fn(tx);
  });

/** Postgres error codes the domain layer maps to business errors. */
export const PG = {
  EXCLUSION_VIOLATION: '23P01',
  UNIQUE_VIOLATION: '23505',
  CHECK_VIOLATION: '23514',
  FK_VIOLATION: '23503',
  SERIALIZATION: '40001',
  DEADLOCK: '40P01',
  INVALID_TRANSITION: 'AP001',
  SERVICE_NOT_PROVIDED: 'AP002',
  HISTORY_IMMUTABLE: 'AP003',
} as const;

export type PgErrorInfo = { code: string; constraint?: string; message: string };

/** Extracts the Postgres error from a (possibly drizzle-wrapped) thrown value. */
export const asPgError = (e: unknown): PgErrorInfo | null => {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur && typeof cur === 'object'; i++) {
    const o = cur as { code?: unknown; constraint?: unknown; message?: unknown; cause?: unknown };
    if (typeof o.code === 'string' && /^[0-9A-Z]{5}$/.test(o.code)) {
      return {
        code: o.code,
        ...(typeof o.constraint === 'string' ? { constraint: o.constraint } : {}),
        message: typeof o.message === 'string' ? o.message : '',
      };
    }
    cur = o.cause;
  }
  return null;
};
