import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { schema, type Tx } from '@clinic/db';
import {
  FREE_CANCEL_HOURS,
  localDateOf,
  appError,
  err,
  ok,
  type AppError,
  type ConfirmBookingInput,
  type HoldSlotInput,
  type RescheduleInput,
  type Result,
} from '@clinic/shared';
import { fail, setHistoryMeta, transact, type Actor, type Ctx, type TxEnv } from './context.js';
import {
  canTouch,
  checkFutureLimit,
  getAppointment,
  getAppointmentLockingPatient,
  loadClinic,
  lockDoctorDay,
  lockPatient,
  notifyPatient,
  sweepExpiredHolds,
  validateSlot,
  type Appointment,
} from './core.js';
import { applyPenalty } from './penalties.js';
import { REMINDER_KINDS, cancelTasksOf, enqueueTask, scheduleReminders } from './tasks.js';
import { offerFreedSlot } from './waitlist.js';

const HOUR = 3_600_000;

export type HoldRequest = HoldSlotInput & { patientId?: string | undefined };

/** Who the visit is for, and through which door (online blocks apply to patients only). */
const resolvePatient = (actor: Actor, requested: string | undefined): Result<string, AppError> => {
  if (actor.role === 'patient')
    return actor.patientId ? ok(actor.patientId) : fail('FORBIDDEN', 'No patient profile for this account');
  if (actor.role === 'registrar') return requested ? ok(requested) : fail('BAD_USER_INPUT', 'patientId is required');
  return fail('FORBIDDEN', 'Not allowed to book visits');
};

/**
 * Step 1 of booking: reserve the time for `holdTtlSeconds` while the patient fills the form.
 * One live hold per patient (a new hold replaces the previous: nobody can freeze the grid).
 * Races are decided by the database exclusion constraints, not by checks in code.
 */
export const holdSlot = (ctx: Ctx, actor: Actor, input: HoldRequest): Promise<Result<Appointment, AppError>> =>
  transact(ctx, actor, async (env) => {
    const { tx, now } = env;
    const who = resolvePatient(actor, input.patientId);
    if (!who.ok) return who;
    const patientId = who.value;
    if (actor.role === 'registrar' && actor.clinicId !== input.clinicId)
      return fail('NOT_FOUND', 'Clinic not found');

    const holdClinic = await loadClinic(tx, input.clinicId);
    if (!holdClinic) return fail('NOT_FOUND', 'Clinic not found');
    await lockDoctorDay(tx, input.doctorId, localDateOf(input.startsAt, holdClinic.timeZone));
    const patient = await lockPatient(tx, patientId); // serializes this patient's bookings
    if (!patient) return fail('NOT_FOUND', 'Patient not found');
    if (actor.role === 'patient' && patient.onlineBookingBlockedUntil && patient.onlineBookingBlockedUntil.getTime() > now.getTime())
      return err(appError('ONLINE_BOOKING_BLOCKED', 'Online booking is closed because of missed visits; please call the clinic'));

    const v = await validateSlot(env, input);
    if (!v.ok) return v;

    // replace the patient's previous live hold
    const prev = await tx
      .select({ id: schema.appointments.id })
      .from(schema.appointments)
      .where(and(eq(schema.appointments.patientId, patientId), eq(schema.appointments.status, 'held'), eq(schema.appointments.kind, 'regular')))
      .for('update');
    if (prev.length > 0) {
      await setHistoryMeta(tx, now, actor, { reason: 'replaced_by_new_hold' });
      for (const p of prev) {
        await tx.update(schema.appointments).set({ status: 'cancelled', cancelledAt: now, updatedAt: now }).where(eq(schema.appointments.id, p.id));
        await cancelTasksOf(tx, p.id, ['hold.expire']);
      }
      await setHistoryMeta(tx, now, actor, {});
    }

    const limit = await checkFutureLimit(env, patientId, null);
    if (!limit.ok) return limit;

    const endsAt = new Date(input.startsAt.getTime() + v.value.durationMin * 60_000);
    await sweepExpiredHolds(env, { doctorId: input.doctorId, clinicId: input.clinicId, patientId, needsUltrasound: v.value.needsUltrasound, startsAt: input.startsAt, endsAt });

    const expiresAt = new Date(now.getTime() + ctx.rules.holdTtlSeconds * 1000);
    const [row] = await tx
      .insert(schema.appointments)
      .values({
        patientId,
        doctorId: input.doctorId,
        clinicId: input.clinicId,
        serviceId: input.serviceId,
        startsAt: input.startsAt,
        endsAt,
        prepMinutes: ctx.rules.prepMinutes,
        occupiedUntil: endsAt, // recomputed by trigger
        localDate: v.value.localDate, // recomputed by trigger
        status: 'held',
        kind: 'regular',
        holdExpiresAt: expiresAt,
        priceMinor: v.value.priceMinor,
        currency: v.value.currency,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const appt = row as Appointment;
    await enqueueTask(tx, {
      kind: 'hold.expire',
      runAt: expiresAt,
      dedupeKey: `hold.expire:${appt.id}`,
      payload: { appointmentId: appt.id },
    });
    return ok(appt);
  });

const requestHash = (i: ConfirmBookingInput): string =>
  createHash('sha256').update(JSON.stringify({ a: i.appointmentId })).digest('hex');

/**
 * Step 2: turn the hold into a booking. Idempotent per (actor, key): a replay returns the same
 * visit, the same key for a different hold is rejected. Rejected once the hold's time is up, even
 * by a millisecond: `held` rows are only confirmable while `hold_expires_at > now`.
 */
export const confirmBooking = (ctx: Ctx, actor: Actor, input: ConfirmBookingInput): Promise<Result<Appointment, AppError>> =>
  transact(ctx, actor, async (env) => {
    const { tx, now } = env;
    const actorKey = actor.userId ?? (actor.patientId ? `patient:${actor.patientId}` : 'system');
    const hash = requestHash(input);
    const claimed = await tx.execute(sql`
      INSERT INTO idempotency_keys (actor_key, key, request_hash) VALUES (${actorKey}, ${input.idempotencyKey}, ${hash})
      ON CONFLICT (actor_key, key) DO NOTHING RETURNING key`);
    if (claimed.rows.length === 0) {
      const prior = (await tx.execute(sql`SELECT request_hash, appointment_id FROM idempotency_keys WHERE actor_key = ${actorKey} AND key = ${input.idempotencyKey}`)).rows[0] as { request_hash: string; appointment_id: string | null } | undefined;
      if (!prior || prior.request_hash !== hash) return fail('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was used for a different request');
      if (prior.appointment_id) {
        const a = await getAppointment(tx, prior.appointment_id, false);
        if (a && canTouch(actor, a)) return ok(a);
      }
      return fail('NOT_FOUND', 'Booking not found');
    }

    const peek = await getAppointment(tx, input.appointmentId, false);
    if (peek) await lockDoctorDay(tx, peek.doctorId, peek.localDate);
    const appt = await getAppointmentLockingPatient(tx, input.appointmentId);
    if (!appt || !canTouch(actor, appt) || actor.role === 'doctor') return fail('NOT_FOUND', 'Booking not found');
    const isOffer = appt.kind === 'waitlist_offer';
    const timeIsUp = !!appt.holdExpiresAt && appt.holdExpiresAt.getTime() <= now.getTime();
    // a hold that ran out may already have been released (by a newer booking or the worker):
    // it is still "expired", not "invalid"
    if ((appt.status === 'held' || appt.status === 'cancelled') && timeIsUp)
      return fail(isOffer ? 'OFFER_EXPIRED' : 'HOLD_EXPIRED', isOffer ? 'The offer has expired' : 'The reservation has expired; please pick the time again');
    if (appt.status !== 'held') return fail('INVALID_TRANSITION', 'This booking is not waiting for confirmation');
    if (!appt.holdExpiresAt) return fail('HOLD_EXPIRED', 'The reservation has expired; please pick the time again');

    const patient = await lockPatient(tx, appt.patientId);
    if (!patient) return fail('NOT_FOUND', 'Patient not found');
    if (actor.role === 'patient' && !isOffer && patient.onlineBookingBlockedUntil && patient.onlineBookingBlockedUntil.getTime() > now.getTime())
      return fail('ONLINE_BOOKING_BLOCKED', 'Online booking is closed because of missed visits; please call the clinic');
    const limit = await checkFutureLimit(env, appt.patientId, appt.id);
    if (!limit.ok) return limit;

    // the doctor may have been marked sick / on vacation while the hold was open
    const blocked = await tx.execute(sql`
      SELECT 1 FROM schedule_exceptions WHERE doctor_id = ${appt.doctorId}::uuid AND local_date = ${appt.localDate}::date
        AND kind IN ('vacation', 'sick', 'day_off')`);
    if (blocked.rows.length > 0) return fail('OUTSIDE_WORKING_HOURS', 'The doctor is not working on this day');

    const [row] = await tx
      .update(schema.appointments)
      .set({ status: 'booked', bookedAt: now, holdExpiresAt: null, updatedAt: now })
      .where(eq(schema.appointments.id, appt.id))
      .returning();
    const booked = row as Appointment;

    const clinic = await loadClinic(tx, booked.clinicId);
    await cancelTasksOf(tx, booked.id, ['hold.expire']);
    await tx.execute(sql`UPDATE scheduled_tasks SET status = 'cancelled' WHERE status = 'pending' AND payload->>'appointmentId' = ${booked.id} AND kind = 'offer.expire'`);
    await scheduleReminders(tx, { id: booked.id, version: booked.version, startsAt: booked.startsAt, timeZone: clinic?.timeZone ?? 'UTC' }, now);
    await enqueueTask(tx, {
      kind: 'email.booking_confirmed',
      runAt: now,
      dedupeKey: `email.booking_confirmed:${booked.id}:v${booked.version}`,
      payload: { appointmentId: booked.id },
    });
    await notifyPatient(tx, booked.patientId, 'booking_confirmed', { appointmentId: booked.id });

    if (isOffer) {
      await tx.execute(sql`
        WITH o AS (UPDATE waitlist_offers SET status = 'accepted', responded_at = ${now.toISOString()}::timestamptz
                   WHERE appointment_id = ${booked.id}::uuid AND status = 'pending' RETURNING entry_id)
        UPDATE waitlist_entries SET status = 'fulfilled' WHERE id IN (SELECT entry_id FROM o)`);
    }
    await tx.execute(sql`UPDATE idempotency_keys SET appointment_id = ${booked.id}::uuid WHERE actor_key = ${actorKey} AND key = ${input.idempotencyKey}`);
    return ok(booked);
  });

/** Accepting a waitlist offer is confirming its held visit. */
export const acceptOffer = async (
  ctx: Ctx,
  actor: Actor,
  p: { offerId: string; idempotencyKey: string },
): Promise<Result<Appointment, AppError>> => {
  const o = (await ctx.db.select().from(schema.waitlistOffers).where(eq(schema.waitlistOffers.id, p.offerId)))[0];
  if (!o) return fail('NOT_FOUND', 'Offer not found');
  return confirmBooking(ctx, actor, { appointmentId: o.appointmentId, idempotencyKey: p.idempotencyKey });
};

const isLate = (startsAt: Date, now: Date): boolean => startsAt.getTime() - now.getTime() < FREE_CANCEL_HOURS * HOUR;

/** Penalty bookkeeping when a patient (or the registrar for them) cancels or moves a visit late. */
const penalizeLate = async (env: TxEnv, a: Appointment, kind: 'late_cancel'): Promise<void> => {
  await applyPenalty(env.tx, { patientId: a.patientId, appointmentId: a.id, kind, at: env.now });
};

/**
 * Moves a confirmed visit to another time of the same doctor and service, atomically: one UPDATE
 * of the row. If the new time is taken the update fails and the visit stays exactly as it was.
 * Reminders follow the new time (old ones cancelled, new ones keyed by the new version).
 */
export const rescheduleAppointment = (ctx: Ctx, actor: Actor, input: RescheduleInput): Promise<Result<Appointment, AppError>> =>
  transact(ctx, actor, async (env) => {
    const { tx, now } = env;
    if (actor.role !== 'patient' && actor.role !== 'registrar') return fail('FORBIDDEN', 'Not allowed to move visits');
    const peek = await getAppointment(tx, input.appointmentId, false);
    if (peek) {
      const tz = (await loadClinic(tx, peek.clinicId))?.timeZone;
      if (tz) await lockDoctorDay(tx, peek.doctorId, localDateOf(input.newStartsAt, tz));
    }
    const appt = await getAppointmentLockingPatient(tx, input.appointmentId);
    if (!appt || !canTouch(actor, appt)) return fail('NOT_FOUND', 'Visit not found');
    if (input.expectedVersion !== undefined && input.expectedVersion !== appt.version)
      return fail('VERSION_CONFLICT', 'The visit was changed meanwhile; reload and try again');
    if (appt.status !== 'booked') return fail('INVALID_TRANSITION', 'Only confirmed visits can be moved');
    if (appt.startsAt.getTime() === input.newStartsAt.getTime()) return fail('BAD_USER_INPUT', 'That is the current time');
    if (appt.startsAt.getTime() <= now.getTime()) return fail('INVALID_TRANSITION', 'The visit has already started');

    const v = await validateSlot(env, { clinicId: appt.clinicId, doctorId: appt.doctorId, serviceId: appt.serviceId, startsAt: input.newStartsAt });
    if (!v.ok) return v;
    const endsAt = new Date(input.newStartsAt.getTime() + v.value.durationMin * 60_000);
    await sweepExpiredHolds(env, { doctorId: appt.doctorId, clinicId: appt.clinicId, patientId: appt.patientId, needsUltrasound: v.value.needsUltrasound, startsAt: input.newStartsAt, endsAt });

    const late = isLate(appt.startsAt, now);
    await setHistoryMeta(tx, now, actor, { late });
    const [row] = await tx
      .update(schema.appointments)
      .set({ startsAt: input.newStartsAt, endsAt, updatedAt: now })
      .where(eq(schema.appointments.id, appt.id))
      .returning();
    const moved = row as Appointment;

    await cancelTasksOf(tx, moved.id, REMINDER_KINDS);
    await scheduleReminders(tx, { id: moved.id, version: moved.version, startsAt: moved.startsAt, timeZone: v.value.timeZone }, now);
    if (late) await penalizeLate(env, appt, 'late_cancel');
    await notifyPatient(tx, moved.patientId, 'booking_rescheduled', { appointmentId: moved.id });
    // the time the patient left is free now: hand it to the waiting list in the same transaction
    await offerFreedSlot(env, { doctorId: appt.doctorId, clinicId: appt.clinicId, startsAt: appt.startsAt });
    return ok(moved);
  });

export const cancelAppointment = (
  ctx: Ctx,
  actor: Actor,
  input: { appointmentId: string; reason?: string | undefined },
): Promise<Result<Appointment, AppError>> =>
  transact(ctx, actor, async (env) => {
    const { tx, now } = env;
    if (actor.role === 'doctor' || actor.role === 'manager') return fail('FORBIDDEN', 'Not allowed to cancel visits');
    const appt = await getAppointmentLockingPatient(tx, input.appointmentId);
    if (!appt || !canTouch(actor, appt)) return fail('NOT_FOUND', 'Visit not found');
    if (appt.status === 'cancelled') return ok(appt); // cancelling twice is harmless
    if (appt.status !== 'held' && appt.status !== 'booked') return fail('INVALID_TRANSITION', 'This visit can no longer be cancelled');
    const late = appt.status === 'booked' && isLate(appt.startsAt, now);
    await setHistoryMeta(tx, now, actor, { late, ...(input.reason ? { reason: input.reason } : {}) });
    const [row] = await tx
      .update(schema.appointments)
      .set({ status: 'cancelled', cancelledAt: now, cancelledLate: late, holdExpiresAt: null, updatedAt: now })
      .where(eq(schema.appointments.id, appt.id))
      .returning();
    const cancelled = row as Appointment;
    await cancelTasksOf(tx, cancelled.id, [...REMINDER_KINDS, 'hold.expire']);
    if (late) await penalizeLate(env, appt, 'late_cancel');
    if (appt.status === 'booked') {
      await enqueueTask(tx, { kind: 'email.cancelled', runAt: now, dedupeKey: `email.cancelled:${cancelled.id}`, payload: { appointmentId: cancelled.id } });
      await notifyPatient(tx, cancelled.patientId, 'booking_cancelled', { appointmentId: cancelled.id });
    }
    if (appt.kind === 'waitlist_offer') {
      await tx.execute(sql`UPDATE waitlist_offers SET status = 'declined', responded_at = ${now.toISOString()}::timestamptz WHERE appointment_id = ${cancelled.id}::uuid AND status = 'pending'`);
    }
    await offerFreedSlot(env, { doctorId: appt.doctorId, clinicId: appt.clinicId, startsAt: appt.startsAt });
    return ok(cancelled);
  });

/** Job: a hold ran out. Idempotent; running it early does nothing. */
export const expireHold = (ctx: Ctx, appointmentId: string): Promise<Result<{ released: boolean }, AppError>> =>
  transact<{ released: boolean }>(ctx, { userId: null, role: 'system' }, async (env) => {
    const { tx, now } = env;
    const a = await getAppointment(tx, appointmentId);
    if (!a || a.status !== 'held' || a.kind !== 'regular') return ok({ released: false });
    if (!a.holdExpiresAt || a.holdExpiresAt.getTime() > now.getTime()) return ok({ released: false });
    await setHistoryMeta(tx, now, env.actor, { reason: 'hold_expired' });
    await tx.update(schema.appointments).set({ status: 'cancelled', cancelledAt: now, updatedAt: now }).where(eq(schema.appointments.id, a.id));
    await offerFreedSlot(env, { doctorId: a.doctorId, clinicId: a.clinicId, startsAt: a.startsAt });
    return ok({ released: true });
  });

export type { Tx };
