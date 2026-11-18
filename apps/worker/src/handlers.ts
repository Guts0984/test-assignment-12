import type pg from 'pg';
import { expireHold, expireOffer, type Ctx } from '@clinic/domain';
import { encodeEvent, EVENTS_CHANNEL, type ClinicEvent } from '@clinic/shared';
import { isSendableEmail, renderMail, type Mailer, type MailKind } from './mail.js';
import { loadAppointmentView } from './view.js';

export type WorkerDeps = {
  pool: pg.Pool;
  domain: Ctx;
  mailer: Mailer;
  publish: (e: ClinicEvent) => Promise<void>;
  now: () => Date;
  processingDelayMs: number;
  maxAttempts: number;
  log: (msg: string, extra?: Record<string, unknown>) => void;
};

export type TaskRow = {
  id: string;
  kind: string;
  run_at: Date | string;
  payload: Record<string, unknown>;
  attempts: number;
};

/**
 * - done: work performed, row marked done
 * - stale: the world changed (cancelled, rescheduled): nothing sent, row cancelled
 * - not_due: fired early; stays pending, the dispatcher re-enqueues it
 * - skipped: someone else holds / finished this task (another worker, or already done)
 */
export type TaskOutcome = 'done' | 'stale' | 'not_due' | 'skipped';

type Client = pg.PoolClient;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const publishSafe = async (deps: WorkerDeps, e: ClinicEvent): Promise<void> => {
  try {
    await deps.publish(e);
  } catch (err) {
    // live updates are best effort: clients refetch on reconnect
    deps.log('publish failed', { error: String(err) });
  }
};

/** After a time changed hands on the waiting list, tell whoever now holds the offer (live update). */
const publishOffersAt = async (deps: WorkerDeps, client: Client, doctorId: string, startsAt: Date): Promise<void> => {
  const r = await client.query(
    `SELECT a.id, a.patient_id, a.clinic_id, a.doctor_id FROM waitlist_offers o JOIN appointments a ON a.id = o.appointment_id
     WHERE a.doctor_id = $1 AND a.starts_at = $2 AND o.status = 'pending'`,
    [doctorId, startsAt],
  );
  for (const x of r.rows as Record<string, string>[])
    await publishSafe(deps, { type: 'appointment', appointmentId: String(x['id']), patientId: String(x['patient_id']), clinicId: String(x['clinic_id']), doctorId: String(x['doctor_id']) });
};

const sendKind = async (
  deps: WorkerDeps,
  client: Client,
  task: TaskRow,
  appointmentId: string,
  kind: MailKind,
  requireStatus: (s: string) => boolean,
  requireVersion?: number,
): Promise<TaskOutcome> => {
  const view = await loadAppointmentView(client, appointmentId);
  if (!view || !requireStatus(view.status)) return 'stale';
  if (requireVersion !== undefined && view.version !== requireVersion) return 'stale';
  if (kind.kind === 'reminder' && view.startsAt.getTime() <= deps.now().getTime()) return 'stale';
  if (kind.kind === 'reminder' && view.patientUserId) {
    // in-app reminder, written in the same transaction as the "done" mark
    await client.query(
      `INSERT INTO notifications (user_id, kind, payload) VALUES ($1, $2, $3::jsonb)`,
      [view.patientUserId, `reminder_${kind.hours}h`, JSON.stringify({ appointmentId, version: view.version })],
    );
  }
  if (isSendableEmail(view.patientEmail)) {
    await deps.mailer.send({
      to: view.patientEmail,
      messageId: `<${task.id}@clinic.local>`,
      mail: renderMail(view, kind),
    });
  }
  return 'done';
};

const runHandler = async (deps: WorkerDeps, client: Client, task: TaskRow): Promise<TaskOutcome> => {
  const p = task.payload;
  switch (task.kind) {
    case 'hold.expire': {
      const id = str(p['appointmentId']);
      const before = await loadAppointmentView(client, id);
      const r = await expireHold(deps.domain, id);
      if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
      if (!r.value.released) {
        // not released: either already gone (fine) or not due by the domain clock (retry later)
        return before?.status === 'held' ? 'not_due' : 'stale';
      }
      if (before) await publishSafe(deps, { type: 'availability', clinicId: before.clinicId, doctorId: before.doctorId, localDate: before.localDate });
      if (before) await publishSafe(deps, { type: 'appointment', appointmentId: before.id, patientId: before.patientId, clinicId: before.clinicId, doctorId: before.doctorId });
      if (before) await publishOffersAt(deps, client, before.doctorId, before.startsAt);
      return 'done';
    }
    case 'offer.expire': {
      const offerId = str(p['offerId']);
      const before = await loadAppointmentView(client, str(p['appointmentId']));
      const r = await expireOffer(deps.domain, offerId);
      if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
      if (r.value.outcome === 'not_due') return 'not_due';
      if (r.value.outcome === 'not_pending') return 'stale';
      if (before) {
        await publishSafe(deps, { type: 'availability', clinicId: before.clinicId, doctorId: before.doctorId, localDate: before.localDate });
        await publishSafe(deps, { type: 'offer', offerId, patientId: before.patientId });
        await publishSafe(deps, { type: 'appointment', appointmentId: before.id, patientId: before.patientId, clinicId: before.clinicId, doctorId: before.doctorId });
        await publishOffersAt(deps, client, before.doctorId, before.startsAt);
      }
      return 'done';
    }
    case 'reminder.24h':
    case 'reminder.2h': {
      const hours = task.kind === 'reminder.24h' ? 24 : 2;
      const version = Number(p['version']);
      return sendKind(deps, client, task, str(p['appointmentId']), { kind: 'reminder', hours }, (s) => s === 'booked', Number.isFinite(version) ? version : undefined);
    }
    case 'email.booking_confirmed':
      return sendKind(deps, client, task, str(p['appointmentId']), { kind: 'booking_confirmed' }, (s) => s === 'booked' || s === 'checked_in' || s === 'completed');
    case 'email.cancelled':
      return sendKind(deps, client, task, str(p['appointmentId']), { kind: 'cancelled' }, (s) => s === 'cancelled');
    case 'email.sick_cancel':
      return sendKind(deps, client, task, str(p['appointmentId']), { kind: 'sick_cancel' }, (s) => s === 'cancelled');
    case 'email.waitlist_offer': {
      const view = await loadAppointmentView(client, str(p['appointmentId']));
      const offer = (await client.query('SELECT status, expires_at FROM waitlist_offers WHERE id = $1', [str(p['offerId'])])).rows[0];
      if (!view || !offer || offer['status'] !== 'pending') return 'stale';
      // A sick-day mark may be cancelling this very slot right now. It skips tasks a worker already
      // holds, so the check lives here: never announce a time on a day the doctor is off.
      const off = await client.query(
        `SELECT 1 FROM schedule_exceptions WHERE doctor_id = $1 AND local_date = $2::date AND kind IN ('sick', 'vacation', 'day_off')`,
        [view.doctorId, view.localDate],
      );
      if (off.rows.length > 0) return 'stale';
      return sendKind(deps, client, task, str(p['appointmentId']), { kind: 'waitlist_offer', expiresAt: new Date(offer['expires_at'] as string | Date) }, (s) => s === 'held');
    }
    default:
      throw new Error(`unknown task kind ${task.kind}`);
  }
};

/**
 * Executes one ledger task EXACTLY ONCE across any number of workers and any number of duplicate
 * queue jobs. The Postgres row is the single source of truth: `FOR UPDATE SKIP LOCKED` on a
 * still-pending row admits one worker; the row is marked done in the same transaction as the
 * in-app notification. The only theoretical duplicate is a crash between the SMTP "250 OK" and the
 * commit; the deterministic Message-ID (`<task-id@clinic.local>`) lets a mail server dedupe it.
 */
export const processTask = async (deps: WorkerDeps, taskId: string): Promise<TaskOutcome> => {
  const client = await deps.pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT id, kind, run_at, payload, attempts FROM scheduled_tasks
       WHERE id = $1 AND status = 'pending' FOR UPDATE SKIP LOCKED`,
      [taskId],
    );
    const task = found.rows[0] as TaskRow | undefined;
    if (!task) {
      await client.query('ROLLBACK');
      return 'skipped';
    }
    if (new Date(task.run_at).getTime() > deps.now().getTime()) {
      await client.query('ROLLBACK');
      return 'not_due';
    }
    try {
      if (deps.processingDelayMs > 0) await sleep(deps.processingDelayMs);
      const outcome = await runHandler(deps, client, task);
      if (outcome === 'done' || outcome === 'stale') {
        await client.query(
          `UPDATE scheduled_tasks SET status = $2::task_status, done_at = $3, last_error = $4 WHERE id = $1`,
          [task.id, outcome === 'done' ? 'done' : 'cancelled', deps.now(), outcome === 'stale' ? 'stale: appointment changed' : null],
        );
        await client.query('COMMIT');
      } else {
        await client.query('ROLLBACK');
      }
      return outcome;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      await deps.pool
        .query(`UPDATE scheduled_tasks SET attempts = attempts + 1, last_error = $2 WHERE id = $1 AND status = 'pending'`, [task.id, String(e).slice(0, 500)])
        .catch(() => undefined);
      throw e;
    }
  } finally {
    client.release();
  }
};

export const publishToRedis = (redis: { publish: (c: string, m: string) => Promise<unknown> }) => (e: ClinicEvent): Promise<void> =>
  redis.publish(EVENTS_CHANNEL, encodeEvent(e)).then(() => undefined);
