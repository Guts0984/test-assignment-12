import { and, eq, sql } from 'drizzle-orm';
import { asPgError, schema, type Tx } from '@clinic/db';
import {
  MAX_ACTIVE_WAITLIST_ENTRIES,
  err,
  appError,
  addDays,
  localDateOf,
  ok,
  type AppError,
  type JoinWaitlistInput,
  type Result,
} from '@clinic/shared';
import { advisoryLock, isRetryable, mapDbError, setHistoryMeta, transact, type Actor, type Ctx, type TxEnv } from './context.js';
import {
  checkFutureLimit,
  getAppointmentUnderDayLock,
  lockDoctorDay,
  lockPatient,
  loadClinic,
  notifyPatient,
  sweepExpiredHolds,
  validateSlot,
  type Appointment,
} from './core.js';
import { enqueueTask } from './tasks.js';

export type WaitlistEntry = typeof schema.waitlistEntries.$inferSelect;
export type WaitlistOffer = typeof schema.waitlistOffers.$inferSelect;

export const joinWaitlist = (
  ctx: Ctx,
  actor: Actor,
  input: JoinWaitlistInput,
): Promise<Result<WaitlistEntry, AppError>> =>
  transact(ctx, actor, async ({ tx, now }) => {
    if (actor.role !== 'patient' || !actor.patientId)
      return err(appError('FORBIDDEN', 'Only patients join the waiting list'));
    const patient = await lockPatient(tx, actor.patientId);
    if (!patient) return err(appError('NOT_FOUND', 'Patient not found'));
    const provides = await tx
      .select()
      .from(schema.doctorServices)
      .where(and(eq(schema.doctorServices.doctorId, input.doctorId), eq(schema.doctorServices.serviceId, input.serviceId)));
    if (provides.length === 0) return err(appError('SERVICE_NOT_PROVIDED', 'The doctor does not provide this service'));
    if (input.toDate < addDays(now.toISOString().slice(0, 10), -1))
      return err(appError('BAD_USER_INPUT', 'The date range is in the past', { toDate: 'in the past' }));
    const mine = await tx
      .select()
      .from(schema.waitlistEntries)
      .where(and(eq(schema.waitlistEntries.patientId, actor.patientId), eq(schema.waitlistEntries.status, 'active')));
    const same = mine.find(
      (e) => e.doctorId === input.doctorId && e.serviceId === input.serviceId && e.fromDate <= input.toDate && e.toDate >= input.fromDate,
    );
    if (same) return ok(same); // joining twice is harmless
    if (mine.length >= MAX_ACTIVE_WAITLIST_ENTRIES)
      return err(appError('WAITLIST_LIMIT_REACHED', `At most ${MAX_ACTIVE_WAITLIST_ENTRIES} active waiting-list requests`));
    const [row] = await tx
      .insert(schema.waitlistEntries)
      .values({
        patientId: actor.patientId,
        doctorId: input.doctorId,
        serviceId: input.serviceId,
        fromDate: input.fromDate,
        toDate: input.toDate,
        createdAt: now,
      })
      .returning();
    return ok(row as WaitlistEntry);
  });

export const leaveWaitlist = (ctx: Ctx, actor: Actor, entryId: string): Promise<Result<true, AppError>> =>
  transact(ctx, actor, async ({ tx }) => {
    const rows = await tx.select().from(schema.waitlistEntries).where(eq(schema.waitlistEntries.id, entryId)).for('update');
    const e = rows[0];
    if (!e || actor.role !== 'patient' || e.patientId !== actor.patientId) return err(appError('NOT_FOUND', 'Request not found'));
    await tx.update(schema.waitlistEntries).set({ status: 'cancelled' }).where(eq(schema.waitlistEntries.id, entryId));
    return ok(true as const);
  });

type Candidate = { id: string; patient_id: string; service_id: string };

/**
 * A visit time just became free (cancel, reschedule away, expired hold or offer). Offers it to the
 * first suitable person in the queue, in the SAME transaction as the release, so the slot is never
 * visible as free in between and is never offered to two people (the exclusion constraint allows
 * one live held row per time).
 *
 * Queue order: priority DESC (people displaced by a sick day first), then request time.
 * Suitable = the request's date range and doctor match, the request's service fits starting
 * here, the patient may book it (3-visit limit, no overlap, one visit per doctor per day) and
 * has not already been offered this very time. Unsuitable people stay in the queue.
 * An offer lasts `offerTtlSeconds`; then `expireOffer` passes it on.
 */
export const offerFreedSlot = async (
  env: TxEnv,
  freed: { doctorId: string; clinicId: string; startsAt: Date },
): Promise<WaitlistOffer | null> => {
  const { tx, now, ctx } = env;
  if (freed.startsAt.getTime() < now.getTime() + ctx.rules.minLeadMinutes * 60_000) return null;
  const clinic = await loadClinic(tx, freed.clinicId);
  if (!clinic) return null;
  const localDate = localDateOf(freed.startsAt, clinic.timeZone);
  // The doctor-day lock (a no-op when the caller already holds it, as every release does) makes the
  // schedule check below see a sick mark that committed before us, and a sick mark that is still
  // running makes us wait and then find the day closed: no offers on a sick day.
  await lockDoctorDay(tx, freed.doctorId, localDate);
  // one handoff at a time per doctor keeps the queue order exact
  await advisoryLock(tx, 'waitlist-handoff', freed.doctorId);

  const candidates = (
    await tx.execute(sql`
      SELECT e.id, e.patient_id, e.service_id FROM waitlist_entries e
      WHERE e.doctor_id = ${freed.doctorId}::uuid AND e.status = 'active'
        AND e.from_date <= ${localDate}::date AND e.to_date >= ${localDate}::date
        AND NOT EXISTS (SELECT 1 FROM waitlist_offers o JOIN waitlist_entries e2 ON e2.id = o.entry_id
                        WHERE e2.patient_id = e.patient_id AND o.status = 'pending')
        AND NOT EXISTS (
          SELECT 1 FROM waitlist_offers o JOIN appointments a ON a.id = o.appointment_id
          WHERE o.entry_id = e.id AND a.doctor_id = ${freed.doctorId}::uuid
            AND a.starts_at = ${freed.startsAt.toISOString()}::timestamptz)
      ORDER BY e.priority DESC, e.created_at, e.id
      LIMIT 25`)
  ).rows as unknown as Candidate[];

  for (const c of candidates) {
    const v = await validateSlot(env, {
      clinicId: freed.clinicId,
      doctorId: freed.doctorId,
      serviceId: c.service_id,
      startsAt: freed.startsAt,
    });
    if (!v.ok) continue;
    // SKIP LOCKED: a patient who is booking right now is passed over instead of waited for, so a
    // release can never deadlock against a booking transaction.
    const locked = (
      await tx.execute(sql`SELECT id FROM patients WHERE id = ${c.patient_id}::uuid FOR UPDATE SKIP LOCKED`)
    ).rows;
    if (locked.length === 0) continue;
    // one pending offer per patient, re-checked now that the patient is locked: an offer for another
    // doctor may have been committed after the candidate list was read
    const already = (
      await tx.execute(sql`SELECT 1 FROM waitlist_offers o JOIN waitlist_entries e ON e.id = o.entry_id
        WHERE e.patient_id = ${c.patient_id}::uuid AND o.status = 'pending' LIMIT 1`)
    ).rows;
    if (already.length > 0) continue;
    const limit = await checkFutureLimit(env, c.patient_id, null);
    if (!limit.ok) continue;

    const endsAt = new Date(freed.startsAt.getTime() + v.value.durationMin * 60_000);
    try {
      const offer = await tx.transaction(async (sp) => {
        const spEnv = { ...env, tx: sp };
        await sweepExpiredHolds(spEnv, {
          doctorId: freed.doctorId,
          clinicId: freed.clinicId,
          patientId: c.patient_id,
          needsUltrasound: v.value.needsUltrasound,
          startsAt: freed.startsAt,
          endsAt,
        });
        const expiresAt = new Date(now.getTime() + ctx.rules.offerTtlSeconds * 1000);
        await setHistoryMeta(sp, now, env.actor, { reason: 'waitlist_offer' });
        const [appt] = await sp
          .insert(schema.appointments)
          .values({
            patientId: c.patient_id,
            doctorId: freed.doctorId,
            clinicId: freed.clinicId,
            serviceId: c.service_id,
            startsAt: freed.startsAt,
            endsAt,
            prepMinutes: ctx.rules.prepMinutes,
            occupiedUntil: endsAt, // recomputed by trigger
            localDate,
            status: 'held',
            kind: 'waitlist_offer',
            holdExpiresAt: expiresAt,
            priceMinor: v.value.priceMinor,
            currency: v.value.currency,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        const a = appt as Appointment;
        const [o] = await sp
          .insert(schema.waitlistOffers)
          .values({ entryId: c.id, appointmentId: a.id, expiresAt, createdAt: now })
          .returning();
        return o as WaitlistOffer;
      });
      await enqueueTask(tx, {
        kind: 'offer.expire',
        runAt: offer.expiresAt,
        dedupeKey: `offer.expire:${offer.id}`,
        payload: { offerId: offer.id, appointmentId: offer.appointmentId },
      });
      await enqueueTask(tx, {
        kind: 'email.waitlist_offer',
        runAt: now,
        dedupeKey: `email.waitlist_offer:${offer.id}`,
        payload: { offerId: offer.id, appointmentId: offer.appointmentId },
      });
      await notifyPatient(tx, c.patient_id, 'waitlist_offer', { offerId: offer.id, appointmentId: offer.appointmentId, expiresAt: offer.expiresAt.toISOString() });
      return offer;
    } catch (e) {
      // the time is not actually usable for this person (partially busy, overlaps their own
      // visit, daily limit): the savepoint is rolled back, try the next one
      if (isRetryable(e)) throw e; // a lost lock race is not "this person cannot have the time"
      const mapped = mapDbError(e);
      if (mapped || asPgError(e)) continue;
      throw e;
    }
  }
  return null;
};

/** Cancels the held row of an offer, marks the offer, and passes the time on. */
const closeOffer = async (
  env: TxEnv,
  offer: WaitlistOffer,
  appt: Appointment,
  status: 'declined' | 'expired',
  reason: string,
): Promise<{ next: WaitlistOffer | null }> => {
  // When the worker runs the expiry it holds a lock on its own `offer.expire` task row (and marks
  // it done itself); touching that row from here would wait for ourselves forever.
  const cancelKinds = status === 'expired' ? sql`'email.waitlist_offer'` : sql`'offer.expire', 'email.waitlist_offer'`;
  const { tx, now, actor } = env;
  await setHistoryMeta(tx, now, actor, { reason });
  await tx.update(schema.waitlistOffers).set({ status, respondedAt: now }).where(eq(schema.waitlistOffers.id, offer.id));
  await tx
    .update(schema.appointments)
    .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
    .where(and(eq(schema.appointments.id, appt.id), eq(schema.appointments.status, 'held')));
  await tx.execute(sql`UPDATE scheduled_tasks SET status = 'cancelled' WHERE id IN (
    SELECT id FROM scheduled_tasks WHERE status = 'pending' AND payload->>'offerId' = ${offer.id} AND kind IN (${cancelKinds}) FOR UPDATE SKIP LOCKED)`);
  const next = await offerFreedSlot(env, { doctorId: appt.doctorId, clinicId: appt.clinicId, startsAt: appt.startsAt });
  return { next };
};

export type OfferOutcome = 'closed' | 'not_due' | 'not_pending';

/** Job: the patient did not answer in time. Idempotent; safe to run twice or early. */
export const expireOffer = (
  ctx: Ctx,
  offerId: string,
): Promise<Result<{ outcome: OfferOutcome; next: WaitlistOffer | null }, AppError>> =>
  transact<{ outcome: OfferOutcome; next: WaitlistOffer | null }>(ctx, { userId: null, role: 'system' }, async (env) => {
    const { tx, now } = env;
    const first = (await tx.select().from(schema.waitlistOffers).where(eq(schema.waitlistOffers.id, offerId)))[0];
    if (!first) return err(appError('NOT_FOUND', 'Offer not found'));
    // doctor-day -> patient -> visit row (as everywhere), only then the offer row
    const appt = await getAppointmentUnderDayLock(tx, first.appointmentId);
    const offer = (await tx.select().from(schema.waitlistOffers).where(eq(schema.waitlistOffers.id, offerId)).for('update'))[0];
    if (!offer) return err(appError('NOT_FOUND', 'Offer not found'));
    if (offer.status !== 'pending') return ok({ outcome: 'not_pending' as const, next: null });
    if (offer.expiresAt.getTime() > now.getTime()) return ok({ outcome: 'not_due' as const, next: null });
    if (!appt || appt.status !== 'held') return ok({ outcome: 'not_pending' as const, next: null });
    const { next } = await closeOffer(env, offer, appt, 'expired', 'offer_expired');
    return ok({ outcome: 'closed' as const, next });
  });

export const declineOffer = (
  ctx: Ctx,
  actor: Actor,
  offerId: string,
): Promise<Result<{ next: WaitlistOffer | null }, AppError>> =>
  transact(ctx, actor, async (env) => {
    const { tx, now } = env;
    const first = (await tx.select().from(schema.waitlistOffers).where(eq(schema.waitlistOffers.id, offerId)))[0];
    if (!first) return err(appError('NOT_FOUND', 'Offer not found'));
    const appt = await getAppointmentUnderDayLock(tx, first.appointmentId);
    const offer = (await tx.select().from(schema.waitlistOffers).where(eq(schema.waitlistOffers.id, offerId)).for('update'))[0];
    if (!offer) return err(appError('NOT_FOUND', 'Offer not found'));
    if (!appt || actor.role !== 'patient' || appt.patientId !== actor.patientId) return err(appError('NOT_FOUND', 'Offer not found'));
    if (offer.status !== 'pending' || appt.status !== 'held') return err(appError('INVALID_TRANSITION', 'The offer is no longer open'));
    if (offer.expiresAt.getTime() <= now.getTime()) return err(appError('OFFER_EXPIRED', 'The offer has expired'));
    const { next } = await closeOffer(env, offer, appt, 'declined', 'offer_declined');
    return ok({ next });
  });

export type { Tx };
