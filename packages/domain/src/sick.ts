import { sql } from 'drizzle-orm';
import { schema } from '@clinic/db';
import { addDays, isoWeekday, ok, type AppError, type Result } from '@clinic/shared';
import { fail, setHistoryMeta, transact, type Actor, type Ctx } from './context.js';
import { lockDoctorDay, lockPatientsSorted, notifyPatient } from './core.js';
import { REMINDER_KINDS, cancelTasksOf, enqueueTask } from './tasks.js';

export type SickResult = { cancelled: number; alreadyMarked: boolean };

/**
 * The doctor is ill on a date: record the exception, cancel every held/booked visit of that day
 * (no penalty for the patient), queue one email each, and put those patients first in the doctor's
 * waiting list (priority 1, next 14 days). Safe to repeat or run concurrently: advisory lock per
 * (doctor, date), and every task has a dedupe key, so a second call creates nothing new.
 */
export const markDoctorSick = (
  ctx: Ctx,
  actor: Actor,
  input: { doctorId: string; localDate: string },
): Promise<Result<SickResult, AppError>> =>
  transact(ctx, actor, async (env) => {
    const { tx, now } = env;
    if (actor.role !== 'registrar' && actor.role !== 'system')
      return fail('FORBIDDEN', 'Only the registrar records sick days');
    await lockDoctorDay(tx, input.doctorId, input.localDate);

    // which clinic does the doctor work in that day? (the registrar must belong to it)
    const ex = (
      await tx.execute(
        sql`SELECT kind, clinic_id FROM schedule_exceptions WHERE doctor_id = ${input.doctorId}::uuid AND local_date = ${input.localDate}::date`,
      )
    ).rows[0] as { kind: string; clinic_id: string | null } | undefined;
    let clinicId: string | null = null;
    if (ex?.kind === 'sick') clinicId = null;
    else if (ex && (ex.kind === 'extra_day' || ex.kind === 'custom_hours')) clinicId = ex.clinic_id;
    else if (!ex) {
      const t = (
        await tx.execute(
          sql`SELECT clinic_id FROM schedule_templates WHERE doctor_id = ${input.doctorId}::uuid AND weekday = ${isoWeekday(input.localDate)}`,
        )
      ).rows[0] as { clinic_id: string } | undefined;
      clinicId = t?.clinic_id ?? null;
    }
    if (actor.role === 'registrar') {
      let mine = clinicId === actor.clinicId;
      if (!mine && (ex?.kind === 'sick' || ex?.kind === 'vacation' || ex?.kind === 'day_off')) {
        // the day is already off: the registrar may still mark it if the doctor has visits in their clinic
        const r = await tx.execute(
          sql`SELECT 1 FROM appointments WHERE doctor_id = ${input.doctorId}::uuid AND local_date = ${input.localDate}::date AND clinic_id = ${actor.clinicId ?? null}::uuid LIMIT 1`,
        );
        mine =
          r.rows.length > 0 ||
          (
            await tx.execute(
              sql`SELECT 1 FROM schedule_templates WHERE doctor_id = ${input.doctorId}::uuid AND weekday = ${isoWeekday(input.localDate)} AND clinic_id = ${actor.clinicId ?? null}::uuid`,
            )
          ).rows.length > 0;
      }
      if (!mine) return fail('NOT_FOUND', 'The doctor does not work in your clinic on that day');
    }

    const upsert = await tx.execute(sql`
      INSERT INTO schedule_exceptions (doctor_id, local_date, kind, created_at)
      VALUES (${input.doctorId}::uuid, ${input.localDate}::date, 'sick', ${now.toISOString()}::timestamptz)
      ON CONFLICT (doctor_id, local_date) DO UPDATE
        SET kind = 'sick', clinic_id = NULL, start_local = NULL, end_local = NULL, break_start_local = NULL, break_end_local = NULL
        WHERE schedule_exceptions.kind <> 'sick'
      RETURNING id`);
    const alreadyMarked = upsert.rows.length === 0;

    // Lock order: doctor-day (held) -> patient rows -> appointment rows. Under the day lock nobody can
    // add visits to this day, so the set of patients is stable: read it, lock those patients in id
    // order, and only then lock (and re-read) the visits.
    const affected = (
      await tx.execute(sql`
      SELECT DISTINCT patient_id FROM appointments
      WHERE doctor_id = ${input.doctorId}::uuid AND local_date = ${input.localDate}::date AND status IN ('held', 'booked')`)
    ).rows as { patient_id: string }[];
    await lockPatientsSorted(
      tx,
      affected.map((r) => r.patient_id),
    );
    const victims = (
      await tx.execute(sql`
      SELECT id, patient_id, service_id, status, kind FROM appointments
      WHERE doctor_id = ${input.doctorId}::uuid AND local_date = ${input.localDate}::date AND status IN ('held', 'booked')
      ORDER BY starts_at, id FOR UPDATE`)
    ).rows as {
      id: string;
      patient_id: string;
      service_id: string;
      status: string;
      kind: string;
    }[];

    await setHistoryMeta(tx, now, actor, { reason: 'doctor_sick' });
    for (const v of victims) {
      await tx
        .update(schema.appointments)
        .set({
          status: 'cancelled',
          cancelledAt: now,
          cancelledLate: false,
          holdExpiresAt: null,
          updatedAt: now,
        })
        .where(sql`${schema.appointments.id} = ${v.id}`);
      await cancelTasksOf(tx, v.id, [...REMINDER_KINDS, 'hold.expire']);
      if (v.kind === 'waitlist_offer') {
        await tx.execute(
          sql`UPDATE waitlist_offers SET status = 'expired', responded_at = ${now.toISOString()}::timestamptz WHERE appointment_id = ${v.id}::uuid AND status = 'pending'`,
        );
        await cancelTasksOf(tx, v.id, ['offer.expire', 'email.waitlist_offer']);
      }
      if (v.status !== 'booked') continue;
      await enqueueTask(tx, {
        kind: 'email.sick_cancel',
        runAt: now,
        dedupeKey: `email.sick_cancel:${v.id}`,
        payload: { appointmentId: v.id },
      });
      await notifyPatient(tx, v.patient_id, 'sick_cancel', { appointmentId: v.id });
      await tx.execute(sql`
        INSERT INTO waitlist_entries (patient_id, doctor_id, service_id, from_date, to_date, priority, created_at)
        SELECT ${v.patient_id}::uuid, ${input.doctorId}::uuid, ${v.service_id}::uuid, ${addDays(input.localDate, 1)}::date, ${addDays(input.localDate, 14)}::date, 1, ${now.toISOString()}::timestamptz
        WHERE NOT EXISTS (
          SELECT 1 FROM waitlist_entries e WHERE e.patient_id = ${v.patient_id}::uuid AND e.doctor_id = ${input.doctorId}::uuid
            AND e.service_id = ${v.service_id}::uuid AND e.status = 'active' AND e.priority = 1
            AND e.from_date <= ${addDays(input.localDate, 14)}::date AND e.to_date >= ${addDays(input.localDate, 1)}::date)`);
    }
    return ok({ cancelled: victims.filter((v) => v.status === 'booked').length, alreadyMarked });
  });
