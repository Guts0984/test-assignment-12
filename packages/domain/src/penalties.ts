import { sql } from 'drizzle-orm';
import type { Tx } from '@clinic/db';
import { ONLINE_BLOCK_DAYS, PENALTY_THRESHOLD, PENALTY_WINDOW_DAYS } from '@clinic/shared';

const DAY = 86_400_000;

/**
 * Records a no-show / late cancel and, when this is the 2nd within 90 days, closes online
 * booking for 30 days. One penalty per (appointment, kind), so retries cannot double count.
 */
export const applyPenalty = async (
  tx: Tx,
  p: { patientId: string; appointmentId: string; kind: 'no_show' | 'late_cancel'; at: Date },
): Promise<{ blockedUntil: Date | null }> => {
  await tx.execute(sql`
    INSERT INTO penalty_events (patient_id, kind, appointment_id, at)
    VALUES (${p.patientId}::uuid, ${p.kind}::penalty_kind, ${p.appointmentId}::uuid, ${p.at.toISOString()}::timestamptz)
    ON CONFLICT (appointment_id, kind) DO NOTHING`);
  const windowStart = new Date(p.at.getTime() - PENALTY_WINDOW_DAYS * DAY);
  const r = await tx.execute(sql`
    SELECT count(*)::int AS n FROM penalty_events
    WHERE patient_id = ${p.patientId}::uuid AND at > ${windowStart.toISOString()}::timestamptz AND at <= ${p.at.toISOString()}::timestamptz`);
  const n = Number((r.rows[0] as { n: number }).n);
  if (n < PENALTY_THRESHOLD) return { blockedUntil: null };
  const until = new Date(p.at.getTime() + ONLINE_BLOCK_DAYS * DAY);
  await tx.execute(sql`
    UPDATE patients SET online_booking_blocked_until = ${until.toISOString()}::timestamptz
    WHERE id = ${p.patientId}::uuid
      AND (online_booking_blocked_until IS NULL OR online_booking_blocked_until < ${until.toISOString()}::timestamptz)`);
  return { blockedUntil: until };
};
