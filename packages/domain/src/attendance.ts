import { eq } from 'drizzle-orm';
import { schema } from '@clinic/db';
import { CHECK_IN_OPENS_MINUTES_BEFORE, ok, type AppError, type Result } from '@clinic/shared';
import { fail, setHistoryMeta, transact, type Actor, type Ctx } from './context.js';
import { canTouch, getAppointmentLockingPatient, type Appointment } from './core.js';
import { applyPenalty } from './penalties.js';
import { cancelTasksOf, REMINDER_KINDS } from './tasks.js';

const OPENS_MS = CHECK_IN_OPENS_MINUTES_BEFORE * 60_000;

/** Registrar: the patient arrived. Opens 30 minutes before the visit. */
export const checkIn = (
  ctx: Ctx,
  actor: Actor,
  appointmentId: string,
): Promise<Result<Appointment, AppError>> =>
  transact(ctx, actor, async ({ tx, now }) => {
    if (actor.role !== 'registrar')
      return fail('FORBIDDEN', 'Only the registrar checks patients in');
    const a = await getAppointmentLockingPatient(tx, appointmentId);
    if (!a || !canTouch(actor, a)) return fail('NOT_FOUND', 'Visit not found');
    if (a.status !== 'booked')
      return fail('INVALID_TRANSITION', 'Only confirmed visits can be checked in');
    if (now.getTime() < a.startsAt.getTime() - OPENS_MS)
      return fail('INVALID_TRANSITION', 'Check-in opens 30 minutes before the visit');
    const [row] = await tx
      .update(schema.appointments)
      .set({ status: 'checked_in', updatedAt: now })
      .where(eq(schema.appointments.id, a.id))
      .returning();
    await cancelTasksOf(tx, a.id, REMINDER_KINDS);
    return ok(row as Appointment);
  });

/** Registrar or the visit's own doctor: the patient did not come. Only after the start time. */
export const markNoShow = (
  ctx: Ctx,
  actor: Actor,
  appointmentId: string,
): Promise<Result<Appointment, AppError>> =>
  transact(ctx, actor, async ({ tx, now }) => {
    if (actor.role !== 'registrar' && actor.role !== 'doctor')
      return fail('FORBIDDEN', 'Not allowed');
    const a = await getAppointmentLockingPatient(tx, appointmentId);
    if (!a || !canTouch(actor, a)) return fail('NOT_FOUND', 'Visit not found');
    if (a.status !== 'booked')
      return fail('INVALID_TRANSITION', 'Only confirmed visits can be marked as no-show');
    if (now.getTime() < a.startsAt.getTime())
      return fail('INVALID_TRANSITION', 'The visit has not started yet');
    const [row] = await tx
      .update(schema.appointments)
      .set({ status: 'no_show', updatedAt: now })
      .where(eq(schema.appointments.id, a.id))
      .returning();
    await cancelTasksOf(tx, a.id, REMINDER_KINDS);
    await applyPenalty(tx, {
      patientId: a.patientId,
      appointmentId: a.id,
      kind: 'no_show',
      at: now,
    });
    return ok(row as Appointment);
  });

/**
 * Doctor: the visit is done. From `checked_in`; from `booked` too (when the registrar did not
 * check the patient in), in which case the check-in is recorded first, by the doctor.
 */
export const completeVisit = (
  ctx: Ctx,
  actor: Actor,
  appointmentId: string,
): Promise<Result<Appointment, AppError>> =>
  transact(ctx, actor, async ({ tx, now }) => {
    if (actor.role !== 'doctor') return fail('FORBIDDEN', 'Only the doctor completes a visit');
    const a = await getAppointmentLockingPatient(tx, appointmentId);
    if (!a || !canTouch(actor, a)) return fail('NOT_FOUND', 'Visit not found');
    if (a.status === 'booked') {
      if (now.getTime() < a.startsAt.getTime() - OPENS_MS)
        return fail('INVALID_TRANSITION', 'The visit has not started yet');
      await tx
        .update(schema.appointments)
        .set({ status: 'checked_in', updatedAt: now })
        .where(eq(schema.appointments.id, a.id));
      await cancelTasksOf(tx, a.id, REMINDER_KINDS);
    } else if (a.status !== 'checked_in') {
      return fail('INVALID_TRANSITION', 'Only a visit in progress can be completed');
    }
    await setHistoryMeta(tx, now, actor, {});
    const [row] = await tx
      .update(schema.appointments)
      .set({ status: 'completed', updatedAt: now })
      .where(eq(schema.appointments.id, a.id))
      .returning();
    return ok(row as Appointment);
  });
