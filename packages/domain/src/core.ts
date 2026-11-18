import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { loadAvailabilityInputs, schema, type Tx } from '@clinic/db';
import {
  MAX_FUTURE_APPOINTMENTS,
  err,
  localDateOf,
  ok,
  type AppError,
  type Result,
} from '@clinic/shared';
import { advisoryLock, fail, type Actor, type TxEnv } from './context.js';
import { isWorkingStart } from './grid.js';

export type Appointment = typeof schema.appointments.$inferSelect;
export type Patient = typeof schema.patients.$inferSelect;

/** Visits that count towards the "3 future visits" limit: live holds and confirmed future visits. */
const FUTURE_COUNT_SQL = (patientId: string, now: Date, excludeId: string | null) => sql`
  SELECT count(*)::int AS n FROM appointments
  WHERE patient_id = ${patientId}::uuid AND starts_at > ${now.toISOString()}::timestamptz
    AND (${excludeId}::uuid IS NULL OR id <> ${excludeId}::uuid)
    AND (status IN ('booked', 'checked_in')
         OR (status = 'held' AND kind = 'regular' AND hold_expires_at > ${now.toISOString()}::timestamptz))`;

export const lockPatient = async (tx: Tx, patientId: string): Promise<Patient | null> => {
  const rows = await tx.select().from(schema.patients).where(eq(schema.patients.id, patientId)).for('update');
  return rows[0] ?? null;
};

/** Must be called with the patient row locked, so concurrent bookings of one patient serialize. */
export const checkFutureLimit = async (
  { tx, now }: TxEnv,
  patientId: string,
  excludeId: string | null,
): Promise<Result<true, AppError>> => {
  const r = await tx.execute(FUTURE_COUNT_SQL(patientId, now, excludeId));
  const n = Number((r.rows[0] as { n: number }).n);
  return n >= MAX_FUTURE_APPOINTMENTS
    ? fail('FUTURE_LIMIT_REACHED', `At most ${MAX_FUTURE_APPOINTMENTS} upcoming visits are allowed`)
    : ok(true);
};

/**
 * LOCK ORDER (everywhere): 1) doctor-day advisory lock, 2) patient row, 3) appointment rows.
 * The doctor-day lock is what makes "mark sick" and "book that day" mutually exclusive: a booking
 * either commits before the sick transaction looks for victims (and is cancelled by it) or waits
 * and then sees the sick day. Taken in a different order the flows would deadlock.
 */
export const lockDoctorDay = (tx: Tx, doctorId: string, localDate: string): Promise<unknown> =>
  advisoryLock(tx, 'doctor-day', `${doctorId}:${localDate}`);

/**
 * Patient row first, then appointment rows. Taking them the other way
 * round deadlocks against a concurrent hold by the same patient.
 * Reads the visit unlocked to learn its patient, locks that patient, then locks the visit.
 */
export const getAppointmentLockingPatient = async (tx: Tx, id: string): Promise<Appointment | null> => {
  const peek = await getAppointment(tx, id, false);
  if (!peek) return null;
  await lockPatient(tx, peek.patientId);
  return getAppointment(tx, id, true);
};

/** Locks several doctor-days in one deterministic order (sorted), so two flows that need the same set cannot deadlock. */
export const lockDoctorDays = async (tx: Tx, days: readonly { doctorId: string; localDate: string }[]): Promise<void> => {
  const keys = [...new Set(days.map((d) => `${d.doctorId}:${d.localDate}`))].sort();
  for (const key of keys) await advisoryLock(tx, 'doctor-day', key);
};

/** Locks several patient rows in id order (FOR UPDATE), so flows touching the same patients cannot deadlock. */
export const lockPatientsSorted = async (tx: Tx, patientIds: readonly string[]): Promise<void> => {
  const ids = [...new Set(patientIds)].sort();
  if (ids.length === 0) return;
  await tx.execute(sql`SELECT id FROM patients WHERE id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}) ORDER BY id FOR UPDATE`);
};

/**
 * Full lock order for changing one visit: peek it unlocked, take the doctor-day lock of its day (and of
 * `alsoDays` of the same doctor, e.g. the target of a reschedule), then its patient, then the row.
 * If the visit moved to another day between the peek and the lock, the lock for the new day is taken too.
 */
export const getAppointmentUnderDayLock = async (
  tx: Tx,
  id: string,
  alsoDays: readonly string[] = [],
): Promise<Appointment | null> => {
  let peek = await getAppointment(tx, id, false);
  for (let i = 0; i < 3 && peek; i++) {
    await lockDoctorDays(tx, [peek, ...alsoDays.map((localDate) => ({ doctorId: (peek as Appointment).doctorId, localDate }))]);
    await lockPatient(tx, peek.patientId);
    const a = await getAppointment(tx, id, true);
    if (!a) return null;
    if (a.doctorId === peek.doctorId && a.localDate === peek.localDate) return a;
    peek = a;
  }
  return peek ? getAppointment(tx, id, true) : null;
};

export const getAppointment = async (tx: Tx, id: string, lock = true): Promise<Appointment | null> => {
  const q = tx.select().from(schema.appointments).where(eq(schema.appointments.id, id));
  const rows = lock ? await q.for('update') : await q;
  return rows[0] ?? null;
};

/** Who may see / change this visit. `NOT_FOUND` (not FORBIDDEN) so ids cannot be probed. */
export const canTouch = (actor: Actor, a: Pick<Appointment, 'patientId' | 'clinicId' | 'doctorId'>): boolean => {
  switch (actor.role) {
    case 'system':
      return true;
    case 'patient':
      return !!actor.patientId && actor.patientId === a.patientId;
    case 'registrar':
      return !!actor.clinicId && actor.clinicId === a.clinicId;
    case 'doctor':
      return !!actor.doctorId && actor.doctorId === a.doctorId;
    default:
      return false;
  }
};

export const loadClinic = async (tx: Tx, clinicId: string) => {
  const rows = await tx.select().from(schema.clinics).where(eq(schema.clinics.id, clinicId));
  return rows[0] ?? null;
};

export const clinicTimeZoneOf = async (tx: Tx, clinicId: string): Promise<string | null> =>
  (await loadClinic(tx, clinicId))?.timeZone ?? null;

export type SlotCheck = {
  timeZone: string;
  currency: 'UAH' | 'PLN';
  localDate: string;
  durationMin: number;
  needsUltrasound: boolean;
  priceMinor: number;
};

/**
 * Rule validity of a start time, ignoring who else is booked (the exclusion constraints
 * decide that atomically): booking window, working hours, break, 15-minute grid, schedule
 * exceptions and that the doctor really works in this clinic and offers the service.
 */
export const validateSlot = async (
  env: TxEnv,
  p: { clinicId: string; doctorId: string; serviceId: string; startsAt: Date },
): Promise<Result<SlotCheck, AppError>> => {
  const { tx, now, ctx } = env;
  const lead = now.getTime() + ctx.rules.minLeadMinutes * 60_000;
  const latest = now.getTime() + ctx.rules.maxAdvanceDays * 86_400_000;
  if (p.startsAt.getTime() < lead || p.startsAt.getTime() > latest)
    return fail('OUTSIDE_BOOKING_WINDOW', 'Booking is possible from 2 hours up to 60 days ahead');
  const clinic = await loadClinic(tx, p.clinicId);
  if (!clinic) return fail('NOT_FOUND', 'Clinic not found');
  const localDate = localDateOf(p.startsAt, clinic.timeZone);
  const inputs = await loadAvailabilityInputs(tx, {
    clinicId: p.clinicId,
    serviceId: p.serviceId,
    doctorId: p.doctorId,
    windowStart: p.startsAt,
    windowEnd: p.startsAt,
    fromDate: localDate,
    toDate: localDate,
    now,
  });
  if (!inputs.service) return fail('SERVICE_NOT_PROVIDED', 'This clinic does not offer the service');
  if (!inputs.doctors.some((d) => d.id === p.doctorId))
    return fail('SERVICE_NOT_PROVIDED', 'The doctor does not provide this service in this clinic');
  const okStart = isWorkingStart(
    {
      timeZone: clinic.timeZone,
      clinicId: p.clinicId,
      durationMin: inputs.service.durationMin,
      needsUltrasound: inputs.service.needsUltrasound,
      prepMinutes: ctx.rules.prepMinutes,
      doctorIds: [p.doctorId],
      templates: inputs.templates,
      exceptions: inputs.exceptions,
    },
    p.doctorId,
    p.startsAt,
    localDate,
  );
  if (!okStart) return fail('OUTSIDE_WORKING_HOURS', 'The doctor does not work at this time');
  return ok({
    timeZone: clinic.timeZone,
    currency: clinic.currency,
    localDate,
    durationMin: inputs.service.durationMin,
    needsUltrasound: inputs.service.needsUltrasound,
    priceMinor: inputs.service.priceMinor,
  });
};

/**
 * Frees expired regular holds that would collide with a booking about to be made. A hold swept here
 * is NOT handed to the waiting list: it is released lazily in SQL, in favour of the booking that is
 * being made right now (usually for the very time it blocked), and once it is cancelled the worker's
 * `hold.expire` task finds nothing to release. Only `expireHold` (the worker) hands over expired holds.
 */
export const sweepExpiredHolds = async (
  { tx, now, ctx }: TxEnv,
  p: { doctorId: string; clinicId: string; patientId: string; needsUltrasound: boolean; startsAt: Date; endsAt: Date },
): Promise<void> => {
  const occEnd = new Date(p.endsAt.getTime() + ctx.rules.prepMinutes * 60_000);
  const room = p.needsUltrasound
    ? (await tx.select({ id: schema.rooms.id }).from(schema.rooms).where(and(eq(schema.rooms.clinicId, p.clinicId), eq(schema.rooms.kind, 'ultrasound'))))[0]?.id ?? null
    : null;
  await tx.execute(sql`
    SELECT release_expired_holds(${now.toISOString()}::timestamptz, ${p.doctorId}::uuid, ${room}::uuid,
      ${p.patientId}::uuid, ${p.startsAt.toISOString()}::timestamptz, ${occEnd.toISOString()}::timestamptz)`);
};

/** In-app notification for the patient (if the patient has an account). */
export const notifyPatient = async (
  tx: Tx,
  patientId: string,
  kind: string,
  payload: Record<string, unknown>,
): Promise<void> => {
  await tx.execute(sql`
    INSERT INTO notifications (user_id, kind, payload)
    SELECT p.user_id, ${kind}, ${JSON.stringify(payload)}::jsonb FROM patients p
    WHERE p.id = ${patientId}::uuid AND p.user_id IS NOT NULL`);
};

export const notFound = (what: string): Result<never, AppError> => err({ code: 'NOT_FOUND', message: `${what} not found` });
