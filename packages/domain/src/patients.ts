import { eq } from 'drizzle-orm';
import { schema } from '@clinic/db';
import { ok, type AppError, type Result } from '@clinic/shared';
import { fail, transact, type Actor, type Ctx } from './context.js';
import { confirmBooking, holdSlot } from './booking.js';
import type { Appointment, Patient } from './core.js';

/** Registrar creates (or finds, by phone) a patient who has no online account. */
export const findOrCreatePhonePatient = (
  ctx: Ctx,
  actor: Actor,
  p: { fullName: string; phone: string; email?: string | undefined },
): Promise<Result<Patient, AppError>> =>
  transact(ctx, actor, async ({ tx, now }) => {
    if (actor.role !== 'registrar') return fail('FORBIDDEN', 'Only the registrar registers phone patients');
    const [row] = await tx
      .insert(schema.patients)
      .values({ fullName: p.fullName, phone: p.phone, email: p.email ?? null, createdAt: now })
      .onConflictDoNothing({ target: schema.patients.phone })
      .returning();
    if (row) return ok(row);
    const found = (await tx.select().from(schema.patients).where(eq(schema.patients.phone, p.phone)))[0];
    return found ? ok(found) : fail('NOT_FOUND', 'Patient not found');
  });

/**
 * Phone booking: exactly the web path (hold, then confirm) with the same rules, performed by the
 * registrar for a patient. Only the online-booking block does not apply to registrars.
 */
export const registrarBook = async (
  ctx: Ctx,
  actor: Actor,
  input: { clinicId: string; doctorId: string; serviceId: string; startsAt: Date; patientId: string; idempotencyKey: string },
): Promise<Result<Appointment, AppError>> => {
  const held = await holdSlot(ctx, actor, input);
  if (!held.ok) return held;
  return confirmBooking(ctx, actor, { appointmentId: held.value.id, idempotencyKey: input.idempotencyKey });
};
