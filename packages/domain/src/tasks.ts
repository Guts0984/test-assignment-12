import { sql } from 'drizzle-orm';
import type { Tx } from '@clinic/db';
import { reminderInstants } from '@clinic/shared';

export type TaskKind =
  | 'hold.expire'
  | 'offer.expire'
  | 'reminder.24h'
  | 'reminder.2h'
  | 'email.booking_confirmed'
  | 'email.cancelled'
  | 'email.sick_cancel'
  | 'email.waitlist_offer';

/**
 * Writes a task to the Postgres ledger. The dedupe key makes the insert idempotent: running the
 * same business operation twice cannot create a second task. Workers copy pending tasks into
 * Redis; if Redis is lost they are copied again from here.
 */
export const enqueueTask = async (
  tx: Tx,
  t: { kind: TaskKind; runAt: Date; dedupeKey: string; payload: Record<string, unknown> },
): Promise<void> => {
  await tx.execute(sql`
    INSERT INTO scheduled_tasks (kind, run_at, dedupe_key, payload)
    VALUES (${t.kind}, ${t.runAt.toISOString()}::timestamptz, ${t.dedupeKey}, ${JSON.stringify(t.payload)}::jsonb)
    ON CONFLICT (dedupe_key) DO NOTHING`);
};

/**
 * Pending tasks of an appointment that must not run any more. SKIP LOCKED: a task the worker is
 * executing right now (it holds the row while it calls back into the domain) is not waited for;
 * waiting would be a deadlock the database cannot see. That task finds its target already closed.
 */
export const cancelTasksOf = async (tx: Tx, appointmentId: string, kinds: readonly TaskKind[]): Promise<void> => {
  if (kinds.length === 0) return;
  await tx.execute(sql`
    UPDATE scheduled_tasks SET status = 'cancelled'
    WHERE id IN (
      SELECT id FROM scheduled_tasks
      WHERE status = 'pending' AND payload->>'appointmentId' = ${appointmentId}
        AND kind IN (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})
      FOR UPDATE SKIP LOCKED)`);
};

export const REMINDER_KINDS: readonly TaskKind[] = ['reminder.24h', 'reminder.2h'];

/**
 * Reminders for one version of an appointment. Keyed by version, so after a reschedule the old
 * ones are cancelled and the new ones have different keys. Reminders whose time has already
 * passed (booking made 3 hours ahead has no 24h reminder) are skipped.
 */
export const scheduleReminders = async (
  tx: Tx,
  a: { id: string; version: number; startsAt: Date; timeZone: string },
  now: Date,
): Promise<void> => {
  const r = reminderInstants(a.startsAt, a.timeZone);
  const items = [
    { kind: 'reminder.24h' as const, at: r.h24, hours: 24 },
    { kind: 'reminder.2h' as const, at: r.h2, hours: 2 },
  ];
  for (const it of items) {
    if (it.at.getTime() <= now.getTime()) continue;
    await enqueueTask(tx, {
      kind: it.kind,
      runAt: it.at,
      dedupeKey: `${it.kind}:${a.id}:v${a.version}`,
      payload: { appointmentId: a.id, version: a.version, hours: it.hours },
    });
  }
};
