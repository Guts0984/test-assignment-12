import { sql } from 'drizzle-orm';
import { PG, asPgError, setActorContext, type Db, type Tx } from '@clinic/db';
import {
  appError,
  err,
  type AppError,
  type ErrorCode,
  type Result,
  type Role,
  type Rules,
} from '@clinic/shared';

export type Clock = () => Date;

export type Ctx = {
  readonly db: Db;
  readonly now: Clock;
  readonly rules: Rules;
};

export type Actor = {
  readonly userId: string | null;
  readonly role: Role | 'system';
  readonly patientId?: string | null;
  readonly clinicId?: string | null;
  readonly doctorId?: string | null;
};

export const SYSTEM: Actor = { userId: null, role: 'system' };

export const fail = (code: ErrorCode, message: string): Result<never, AppError> =>
  err(appError(code, message));

const ABORT = Symbol('domain-abort');
type Abort = { [ABORT]: AppError };
const isAbort = (e: unknown): e is Abort => typeof e === 'object' && e !== null && ABORT in e;

/** Maps database errors that mean "you lost a race / broke a rule" to business errors. */
export const mapDbError = (e: unknown): AppError | null => {
  const pg = asPgError(e);
  if (!pg) return null;
  switch (pg.code) {
    case PG.EXCLUSION_VIOLATION:
      if (pg.constraint === 'appointments_room_no_overlap')
        return appError('ROOM_TAKEN', 'The ultrasound room is busy at this time');
      if (pg.constraint === 'appointments_patient_no_overlap')
        return appError('PATIENT_BUSY', 'You already have a visit at this time');
      return appError('SLOT_TAKEN', 'This time is already taken');
    case PG.DEADLOCK:
    case PG.SERIALIZATION:
      // Still failing after the retries in `transact`: nothing was booked.
      return appError('SLOT_TAKEN', 'This time was just taken, please pick another');
    case PG.UNIQUE_VIOLATION:
      if (pg.constraint === 'appointments_patient_doctor_day_uq')
        return appError(
          'DOCTOR_DAILY_LIMIT',
          'You already have a visit to this doctor on that day',
        );
      return null;
    case '22P02': // malformed uuid / enum / date that reached SQL: a client error, never a 500
    case '22007':
    case '22008':
      return appError('BAD_USER_INPUT', 'Malformed value');
    case PG.INVALID_TRANSITION:
      return appError(
        'INVALID_TRANSITION',
        'This change is not allowed for the visit in its current status',
      );
    case PG.SERVICE_NOT_PROVIDED:
      return appError('SERVICE_NOT_PROVIDED', 'The doctor does not provide this service');
    default:
      return null;
  }
};

/** Deadlock / serialization failure: nothing was written, the whole transaction may simply be run again. */
export const isRetryable = (e: unknown): boolean => {
  const pg = asPgError(e);
  return !!pg && (pg.code === PG.DEADLOCK || pg.code === PG.SERIALIZATION);
};

const MAX_ATTEMPTS = 5;
const backoff = (attempt: number): Promise<void> =>
  new Promise((r) => setTimeout(r, Math.random() * 10 * attempt + 1));

export type TxEnv = {
  readonly tx: Tx;
  readonly now: Date;
  readonly ctx: Ctx;
  readonly actor: Actor;
};

/**
 * Runs `fn` in one transaction with actor + injected clock bound for the history trigger.
 * An `err` result rolls everything back and is returned; business-level database errors are
 * mapped; anything else is a bug and is rethrown (the API turns it into a masked 500).
 */
export const transact = async <T>(
  ctx: Ctx,
  actor: Actor,
  fn: (env: TxEnv) => Promise<Result<T, AppError>>,
): Promise<Result<T, AppError>> => {
  const now = ctx.now();
  for (let attempt = 1; ; attempt++) {
    try {
      return await ctx.db.transaction(async (tx) => {
        await setActorContext(tx, {
          actor: { userId: actor.userId, role: actor.role },
          now,
        });
        const r = await fn({ tx, now, ctx, actor });
        if (!r.ok) throw { [ABORT]: r.error } satisfies Abort;
        return r;
      });
    } catch (e) {
      if (isAbort(e)) return err(e[ABORT]);
      // a lost lock race (deadlock victim): rolled back completely, so run it again a few times
      if (isRetryable(e) && attempt < MAX_ATTEMPTS) {
        await backoff(attempt);
        continue;
      }
      const mapped = mapDbError(e);
      if (mapped) return err(mapped);
      throw e;
    }
  }
};

/** Binds a reason / late flag to the next history rows of this transaction. */
export const setHistoryMeta = (
  tx: Tx,
  now: Date,
  actor: Actor,
  meta: { reason?: string; late?: boolean },
): Promise<unknown> =>
  setActorContext(tx, {
    actor: { userId: actor.userId, role: actor.role },
    now,
    ...(meta.reason !== undefined ? { reason: meta.reason } : {}),
    ...(meta.late !== undefined ? { late: meta.late } : {}),
  });

/** Serializes work on one logical resource across transactions (released at commit). */
export const advisoryLock = (tx: Tx, namespace: string, key: string): Promise<unknown> =>
  tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${namespace + ':' + key}, 0))`);
