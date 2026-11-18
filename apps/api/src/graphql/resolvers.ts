import { Args, Context, ID, Int, Mutation, Parent, Query, ResolveField, Resolver, Subscription } from '@nestjs/graphql';
import { Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  AVAILABILITY_DAYS, addDays, availabilityQuerySchema, cancelSchema, confirmBookingSchema, holdSlotSchema, joinWaitlistSchema, markSickSchema, phoneSchema,
  registrarBookingSchema, rescheduleSchema, respondOfferSchema, reportPeriodSchema, scheduleExceptionSchema, scheduleTemplateSchema, signInSchema, signUpSchema, idSchema, type ClinicEvent,
} from '@clinic/shared';
import {
  acceptOffer, cancelAppointment, checkIn, completeVisit, confirmBooking, declineOffer, findOrCreatePhonePatient, getAvailability, holdSlot, joinWaitlist, leaveWaitlist, markDoctorSick, markNoShow,
  registrarBook, removeScheduleException, removeScheduleTemplate, rescheduleAppointment, setScheduleException, setScheduleTemplate, type Actor, type Appointment,
} from '@clinic/domain';
import { loadReport } from '@clinic/db';
import { z } from 'zod';
import { Public, Roles } from '../auth/roles.js';
import { dummyHash, hashPassword, verifyPassword } from '../auth/password.js';
import { clearCookie, createSession, findSessionUser, revokeSession, sessionCookie } from '../auth/sessions.js';
import { gqlError, parseInput, unwrap } from '../infra/errors.js';
import { BUS, DB, DOMAIN, ENV, LIMITERS, type GqlContext, type Limiters } from '../infra/tokens.js';
import { TOPIC, type EventBus } from '../infra/event-bus.js';
import type { ApiEnv } from '../env.js';
import { canReadAppointment, canReadPatientContacts, canReadPatientName } from '../policy.js';
import type { Db } from '@clinic/db';
import type { Ctx } from '@clinic/domain';
import {
  AppointmentEventType, AppointmentType, AvailabilityEventType, CurrencyEnum, AvailabilityType, ClinicServiceType, ClinicType, DoctorScheduleType, DoctorType, NotificationType, PatientType, ReportType,
  ServiceType, SickResultType, SlotType, UserType, VisitScopeEnum, WaitlistEntryType, WaitlistOfferType,
} from './types.js';
import {
  AvailabilityInput, CancelInput, ConfirmBookingInput, ExceptionInput, HoldSlotInput, JoinWaitlistInput, MarkSickInput, RegistrarBookInput, RemoveExceptionInput, RemoveTemplateInput,
  RescheduleInput, RespondOfferInput, SignInInput, SignUpInput, TemplateInput,
} from './inputs.js';
import { APPOINTMENT_COLUMNS, appointmentFromSql, toAppointment } from './mapping.js';

type Row = Record<string, unknown>;
const rows = async (db: Db, q: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(q)).rows as Row[];
const actorOf = (c: GqlContext): Actor => {
  if (!c.actor) throw gqlError('UNAUTHENTICATED', 'Please sign in');
  return c.actor;
};
const limitArg = (n: number | null | undefined, def = 50): number => Math.min(Math.max(n ?? def, 1), 100);
const offsetArg = (n: number | null | undefined): number => Math.min(Math.max(n ?? 0, 0), 10_000);

const consumeOrThrow = async (l: { consume: (k: string) => Promise<{ ok: true } | { ok: false; retryAfterSec: number }> }, key: string): Promise<void> => {
  const r = await l.consume(key);
  if (!r.ok) throw gqlError('RATE_LIMITED', 'Too many requests, please slow down', { retryAfterSec: r.retryAfterSec });
};

// =============== auth ===============
@Resolver()
export class AuthResolver {
  constructor(
    @Inject(ENV) private readonly env: ApiEnv,
    @Inject(DB) private readonly db: Db,
    @Inject(LIMITERS) private readonly limits: Limiters,
    @Inject(DOMAIN) private readonly domain: Ctx,
  ) {}

  private argon() {
    return { memoryCost: this.env.ARGON_MEMORY_KIB, timeCost: this.env.ARGON_TIME_COST };
  }

  @Public() @Query(() => UserType, { nullable: true })
  me(@Context() c: GqlContext): UserType | null {
    return c.user ? { id: c.user.userId, email: c.user.email, role: c.user.role as UserType['role'], fullName: c.user.fullName, patientId: c.user.patientId, clinicId: c.user.clinicId, doctorId: c.user.doctorId, locale: c.user.locale as UserType['locale'] } : null;
  }

  @Public() @Mutation(() => UserType)
  async signUp(@Args('input', { type: () => SignUpInput }) input: SignUpInput, @Context() c: GqlContext): Promise<UserType> {
    const v = parseInput(signUpSchema, input);
    await consumeOrThrow(this.limits.signUp, c.ip);
    const passwordHash = await hashPassword(v.password, this.argon());
    const now = this.domain.now();
    try {
      const created = await this.db.transaction(async (tx) => {
        const u = await tx.execute(sql`INSERT INTO users (email, password_hash, role, created_at) VALUES (${v.email}, ${passwordHash}, 'patient', ${now.toISOString()}::timestamptz) RETURNING id`);
        const userId = String((u.rows[0] as Row)['id']);
        // a patient record may already exist from a phone booking: claim it by phone, else create
        const claimed = await tx.execute(sql`UPDATE patients SET user_id = ${userId}::uuid, email = ${v.email}, locale = ${v.locale}::locale WHERE phone = ${v.phone} AND user_id IS NULL RETURNING id`);
        const pid = claimed.rows[0] ? String((claimed.rows[0] as Row)['id']) : String(((await tx.execute(sql`INSERT INTO patients (user_id, full_name, phone, email, locale, created_at) VALUES (${userId}::uuid, ${v.fullName}, ${v.phone}, ${v.email}, ${v.locale}::locale, ${now.toISOString()}::timestamptz) RETURNING id`)).rows[0] as Row)['id']);
        return { userId, pid };
      });
      const s = await createSession(this.db, created.userId, this.env.SESSION_TTL_HOURS, now);
      c.res?.append('Set-Cookie', sessionCookie(s.token, s.expiresAt, this.env.COOKIE_SECURE));
      return { id: created.userId, email: v.email, role: 'patient' as UserType['role'], fullName: v.fullName, patientId: created.pid, clinicId: null, doctorId: null, locale: v.locale as UserType['locale'] };
    } catch (e) {
      const m = (e as { cause?: { code?: string; constraint?: string } }).cause ?? (e as { code?: string; constraint?: string });
      if (m.code === '23505' && String(m.constraint).includes('email')) throw gqlError('EMAIL_TAKEN', 'This email is already registered', { fieldErrors: { email: 'already registered' } });
      if (m.code === '23505' && String(m.constraint).includes('phone')) throw gqlError('BAD_USER_INPUT', 'This phone number belongs to another account', { fieldErrors: { phone: 'already in use' } });
      throw e;
    }
  }

  @Public() @Mutation(() => UserType)
  async signIn(@Args('input', { type: () => SignInInput }) input: SignInInput, @Context() c: GqlContext): Promise<UserType> {
    const v = parseInput(signInSchema, input);
    // per IP+email stops guessing one account; per IP stops spraying many
    await consumeOrThrow(this.limits.signInIp, c.ip);
    await consumeOrThrow(this.limits.signIn, `${c.ip}|${v.email}`);
    const r = await rows(this.db, sql`SELECT id, password_hash FROM users WHERE lower(email) = ${v.email}`);
    const u = r[0];
    const stored = u ? String(u['password_hash']) : await dummyHash(this.argon());
    const ok = await verifyPassword(stored, v.password);
    if (!u || !ok) throw gqlError('INVALID_CREDENTIALS', 'Wrong email or password');
    const now = this.domain.now();
    const s = await createSession(this.db, String(u['id']), this.env.SESSION_TTL_HOURS, now); // a fresh session id on every login
    c.res?.append('Set-Cookie', sessionCookie(s.token, s.expiresAt, this.env.COOKIE_SECURE));
    const user = await findSessionUser(this.db, s.token, now);
    if (!user) throw gqlError('INTERNAL_SERVER_ERROR', 'Could not start the session');
    return { id: user.userId, email: user.email, role: user.role as UserType['role'], fullName: user.fullName, patientId: user.patientId, clinicId: user.clinicId, doctorId: user.doctorId, locale: user.locale as UserType['locale'] };
  }

  @Public() @Mutation(() => Boolean)
  async signOut(@Context() c: GqlContext): Promise<boolean> {
    if (c.token) await revokeSession(this.db, c.token, this.domain.now());
    c.res?.append('Set-Cookie', clearCookie(this.env.COOKIE_SECURE));
    return true;
  }
}

// =============== catalog + availability (public) ===============
@Resolver()
export class CatalogResolver {
  constructor(@Inject(DB) private readonly db: Db, @Inject(DOMAIN) private readonly domain: Ctx) {}

  @Public() @Query(() => [ClinicType])
  async clinics(): Promise<ClinicType[]> {
    return (await rows(this.db, sql`SELECT id, city, time_zone, currency FROM clinics ORDER BY city`)).map((x) => ({ id: String(x['id']), city: String(x['city']), timeZone: String(x['time_zone']), currency: String(x['currency']) as ClinicType['currency'] }));
  }

  /** Services a clinic offers that at least one of its doctors actually performs. */
  @Public() @Query(() => [ClinicServiceType])
  async clinicServices(@Args('clinicId', { type: () => ID }) clinicId: string): Promise<ClinicServiceType[]> {
    const id = parseInput(idSchema, clinicId);
    const r = await rows(this.db, sql`
      SELECT s.id, s.code, s.specialty, s.name_uk, s.name_en, s.name_pl, s.duration_min, s.needs_ultrasound, cs.price_minor, c.currency
      FROM clinic_services cs JOIN services s ON s.id = cs.service_id JOIN clinics c ON c.id = cs.clinic_id
      WHERE cs.clinic_id = ${id}::uuid
        AND EXISTS (SELECT 1 FROM doctor_services ds JOIN schedule_templates t ON t.doctor_id = ds.doctor_id AND t.clinic_id = cs.clinic_id WHERE ds.service_id = s.id)
      ORDER BY s.specialty, s.name_uk`);
    return r.map((x) => ({ service: { id: String(x['id']), code: String(x['code']), specialty: String(x['specialty']), nameUk: String(x['name_uk']), nameEn: String(x['name_en']), namePl: String(x['name_pl']), durationMin: Number(x['duration_min']), needsUltrasound: Boolean(x['needs_ultrasound']) }, priceMinor: Number(x['price_minor']), currency: String(x['currency']) as CurrencyEnum }));
  }

  @Public() @Query(() => [DoctorType])
  async clinicDoctors(@Args('clinicId', { type: () => ID }) clinicId: string, @Args('serviceId', { type: () => ID, nullable: true }) serviceId?: string): Promise<DoctorType[]> {
    const cid = parseInput(idSchema, clinicId);
    const sid = serviceId ? parseInput(idSchema, serviceId) : null;
    const r = await rows(this.db, sql`
      SELECT DISTINCT d.id, d.full_name, d.specialty FROM doctors d JOIN schedule_templates t ON t.doctor_id = d.id AND t.clinic_id = ${cid}::uuid
      WHERE (${sid}::uuid IS NULL OR EXISTS (SELECT 1 FROM doctor_services ds WHERE ds.doctor_id = d.id AND ds.service_id = ${sid}::uuid))
      ORDER BY d.full_name LIMIT 200`);
    return r.map((x) => ({ id: String(x['id']), fullName: String(x['full_name']), specialty: String(x['specialty']) }));
  }

  /** Free times for a service in a clinic (= city) for 14 clinic-local days. */
  @Public() @Query(() => AvailabilityType)
  async availability(@Args('input', { type: () => AvailabilityInput }) input: AvailabilityInput): Promise<AvailabilityType> {
    // GraphQL clients send explicit nulls for omitted optionals; the shared schema wants them absent
    const q = parseInput(availabilityQuerySchema, { ...input, doctorId: input.doctorId ?? undefined, fromDate: input.fromDate ?? undefined });
    const a = unwrap(await getAvailability(this.domain, { ...q, days: AVAILABILITY_DAYS }));
    return { clinicId: q.clinicId, timeZone: a.timeZone, currency: a.currency as CurrencyEnum, durationMin: a.durationMin, priceMinor: a.priceMinor, doctors: a.doctors, slots: a.slots };
  }
}

@Resolver(() => SlotType)
export class SlotResolver {
  @ResolveField(() => DoctorType, { nullable: true })
  doctor(@Parent() s: SlotType, @Context() c: GqlContext) {
    return c.loaders.doctor.load(s.doctorId);
  }
}

// =============== patients ===============
@Resolver(() => PatientType)
export class PatientFieldResolver {
  @ResolveField(() => [AppointmentType])
  async visits(@Parent() p: PatientType, @Context() c: GqlContext) {
    const now = new Date();
    return (await c.loaders.visits.load(p.id)).map((x) => appointmentFromSql(x, now));
  }
}

// =============== appointments ===============
@Resolver(() => AppointmentType)
export class AppointmentFieldResolver {
  @ResolveField(() => DoctorType)
  async doctor(@Parent() a: AppointmentType, @Context() c: GqlContext) {
    return c.loaders.doctor.load(a.doctorId);
  }
  @ResolveField(() => ClinicType)
  clinic(@Parent() a: AppointmentType, @Context() c: GqlContext) {
    return c.loaders.clinic.load(a.clinicId);
  }
  @ResolveField(() => ServiceType)
  service(@Parent() a: AppointmentType, @Context() c: GqlContext) {
    return c.loaders.service.load(a.serviceId);
  }
  /** Patient details follow the policy: contacts for the patient and the clinic's registrar, the name also for the visit's doctor. */
  @ResolveField(() => PatientType, { nullable: true })
  async patient(@Parent() a: AppointmentType, @Context() c: GqlContext): Promise<PatientType | null> {
    const v = { patientId: a.patientId, clinicId: a.clinicId, doctorId: a.doctorId };
    if (!canReadPatientName(c.actor, v)) return null;
    const p = await c.loaders.patient.load(a.patientId);
    if (!p) return null;
    const contacts = canReadPatientContacts(c.actor, v);
    return { id: p.id, fullName: p.fullName, phone: contacts ? p.phone : null, email: contacts ? p.email : null, onlineBookingBlockedUntil: contacts ? p.onlineBookingBlockedUntil : null, visits: [] };
  }
  @ResolveField(() => [AppointmentEventType])
  async events(@Parent() a: AppointmentType, @Context() c: GqlContext): Promise<AppointmentEventType[]> {
    if (!canReadAppointment(c.actor, { patientId: a.patientId, clinicId: a.clinicId, doctorId: a.doctorId })) return [];
    return (await c.loaders.events.load(a.id)).map((e) => ({ at: e.at, type: e.type, fromStatus: e.fromStatus as AppointmentEventType['fromStatus'], toStatus: e.toStatus as AppointmentEventType['toStatus'], actorRole: e.actorRole, late: e.late, reason: e.reason, oldStartsAt: e.oldStartsAt, newStartsAt: e.newStartsAt }));
  }
}

export const loadVisible = async (db: Db, id: string, actor: Actor | null): Promise<ReturnType<typeof appointmentFromSql> | null> => {
  const r = await rows(db, sql`SELECT ${sql.raw(APPOINTMENT_COLUMNS)} FROM appointments a WHERE a.id = ${id}::uuid`);
  if (!r[0]) return null;
  const a = appointmentFromSql(r[0]);
  return canReadAppointment(actor, a) ? a : null;
};

@Resolver()
export class BookingResolver {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DOMAIN) private readonly domain: Ctx,
    @Inject(LIMITERS) private readonly limits: Limiters,
    @Inject(BUS) private readonly bus: EventBus,
  ) {}

  private async announce(a: Appointment): Promise<void> {
    await this.bus.publish({ type: 'availability', clinicId: a.clinicId, doctorId: a.doctorId, localDate: a.localDate });
    await this.bus.publish({ type: 'appointment', appointmentId: a.id, patientId: a.patientId, clinicId: a.clinicId, doctorId: a.doctorId });
  }

  /** A freed time may have been handed to the next person on the waiting list: tell them, live. */
  private async announceOffersAt(doctorId: string, startsAt: Date): Promise<void> {
    const r = await rows(this.db, sql`SELECT a.id, a.patient_id, a.clinic_id, a.doctor_id FROM waitlist_offers o JOIN appointments a ON a.id = o.appointment_id WHERE a.doctor_id = ${doctorId}::uuid AND a.starts_at = ${startsAt.toISOString()}::timestamptz AND o.status = 'pending'`);
    for (const x of r) await this.bus.publish({ type: 'appointment', appointmentId: String(x['id']), patientId: String(x['patient_id']), clinicId: String(x['clinic_id']), doctorId: String(x['doctor_id']) });
  }

  @Roles('patient', 'registrar', 'doctor') @Query(() => AppointmentType, { nullable: true })
  async appointment(@Args('id', { type: () => ID }) id: string, @Context() c: GqlContext) {
    return loadVisible(this.db, parseInput(idSchema, id), c.actor);
  }

  @Roles('patient') @Query(() => [AppointmentType])
  async myAppointments(
    @Args('scope', { type: () => VisitScopeEnum, defaultValue: VisitScopeEnum.UPCOMING }) scope: VisitScopeEnum,
    @Args('limit', { type: () => Int, nullable: true }) limit: number | null,
    @Args('offset', { type: () => Int, nullable: true }) offset: number | null,
    @Context() c: GqlContext,
  ) {
    const a = actorOf(c);
    if (!a.patientId) return [];
    const upcoming = scope === VisitScopeEnum.UPCOMING;
    const now = this.domain.now();
    const r = await rows(this.db, sql`
      SELECT ${sql.raw(APPOINTMENT_COLUMNS)} FROM appointments a
      WHERE a.patient_id = ${a.patientId}::uuid
        AND ${upcoming
          ? sql`a.starts_at >= ${now.toISOString()}::timestamptz AND (a.status IN ('booked','checked_in') OR (a.status = 'held' AND a.kind = 'regular' AND a.hold_expires_at > ${now.toISOString()}::timestamptz))`
          : sql`(a.starts_at < ${now.toISOString()}::timestamptz AND a.status <> 'held') OR (a.status = 'cancelled' AND a.booked_at IS NOT NULL)`}
      ORDER BY a.starts_at ${upcoming ? sql`ASC` : sql`DESC`} LIMIT ${limitArg(limit)} OFFSET ${offsetArg(offset)}`);
    return r.map((x) => appointmentFromSql(x, now));
  }

  @Roles('patient', 'registrar') @Mutation(() => AppointmentType)
  async holdSlot(@Args('input', { type: () => HoldSlotInput }) input: HoldSlotInput, @Context() c: GqlContext) {
    const v = parseInput(holdSlotSchema, input);
    const actor = actorOf(c);
    await consumeOrThrow(this.limits.hold, actor.userId ?? c.ip);
    const patientId = actor.role === 'registrar' && input.patientId ? parseInput(idSchema, input.patientId) : undefined;
    const a = unwrap(await holdSlot(this.domain, actor, { ...v, patientId }));
    await this.announce(a);
    return toAppointment(a);
  }

  @Roles('patient', 'registrar') @Mutation(() => AppointmentType)
  async confirmBooking(@Args('input', { type: () => ConfirmBookingInput }) input: ConfirmBookingInput, @Context() c: GqlContext) {
    const v = parseInput(confirmBookingSchema, input);
    const a = unwrap(await confirmBooking(this.domain, actorOf(c), v));
    await this.announce(a);
    return toAppointment(a);
  }

  @Roles('patient', 'registrar') @Mutation(() => AppointmentType)
  async rescheduleAppointment(@Args('input', { type: () => RescheduleInput }) input: RescheduleInput, @Context() c: GqlContext) {
    const v = parseInput(rescheduleSchema, { ...input, expectedVersion: input.expectedVersion ?? undefined });
    const before = await this.db.execute(sql`SELECT doctor_id, clinic_id, local_date::text AS d, patient_id, starts_at FROM appointments WHERE id = ${v.appointmentId}::uuid`);
    const a = unwrap(await rescheduleAppointment(this.domain, actorOf(c), v));
    await this.announce(a);
    const was = before.rows[0] as Row | undefined;
    if (was) await this.announceOffersAt(a.doctorId, new Date(String(was['starts_at'])));
    const old = before.rows[0] as Row | undefined;
    if (old && String(old['d']) !== a.localDate) await this.bus.publish({ type: 'availability', clinicId: String(old['clinic_id']), doctorId: String(old['doctor_id']), localDate: String(old['d']) });
    return toAppointment(a);
  }

  @Roles('patient', 'registrar') @Mutation(() => AppointmentType)
  async cancelAppointment(@Args('input', { type: () => CancelInput }) input: CancelInput, @Context() c: GqlContext) {
    const v = parseInput(cancelSchema, { ...input, reason: input.reason ?? undefined });
    const a = unwrap(await cancelAppointment(this.domain, actorOf(c), v));
    await this.announce(a);
    await this.announceOffersAt(a.doctorId, a.startsAt);
    return toAppointment(a);
  }

  @Roles('registrar') @Mutation(() => AppointmentType)
  async registrarBook(@Args('input', { type: () => RegistrarBookInput }) input: RegistrarBookInput, @Context() c: GqlContext) {
    const actor = actorOf(c);
    const patient = input.patientId
      ? { patientId: input.patientId }
      : { fullName: input.newPatientName ?? '', phone: input.newPatientPhone ?? '', ...(input.newPatientEmail ? { email: input.newPatientEmail } : {}) };
    const v = parseInput(registrarBookingSchema.and(z.object({ idempotencyKey: confirmBookingSchema.shape.idempotencyKey })), { ...input, patient });
    let patientId: string;
    if ('patientId' in v.patient) patientId = v.patient.patientId;
    else patientId = unwrap(await findOrCreatePhonePatient(this.domain, actor, v.patient)).id;
    const a = unwrap(await registrarBook(this.domain, actor, { clinicId: v.clinicId, doctorId: v.doctorId, serviceId: v.serviceId, startsAt: v.startsAt, patientId, idempotencyKey: v.idempotencyKey }));
    await this.announce(a);
    return toAppointment(a);
  }

  // ----- attendance (registrar / doctor) -----
  @Roles('registrar') @Mutation(() => AppointmentType)
  async checkIn(@Args('id', { type: () => ID }) id: string, @Context() c: GqlContext) {
    const a = unwrap(await checkIn(this.domain, actorOf(c), parseInput(idSchema, id)));
    await this.announce(a);
    return toAppointment(a);
  }
  @Roles('registrar', 'doctor') @Mutation(() => AppointmentType)
  async markNoShow(@Args('id', { type: () => ID }) id: string, @Context() c: GqlContext) {
    const a = unwrap(await markNoShow(this.domain, actorOf(c), parseInput(idSchema, id)));
    await this.announce(a);
    return toAppointment(a);
  }
  @Roles('doctor') @Mutation(() => AppointmentType)
  async completeVisit(@Args('id', { type: () => ID }) id: string, @Context() c: GqlContext) {
    const a = unwrap(await completeVisit(this.domain, actorOf(c), parseInput(idSchema, id)));
    await this.announce(a);
    return toAppointment(a);
  }

  // ----- staff views -----
  @Roles('registrar') @Query(() => [AppointmentType])
  async clinicBoard(@Args('clinicId', { type: () => ID }) clinicId: string, @Args('date', { type: () => String }) date: string, @Context() c: GqlContext) {
    const a = actorOf(c);
    const cid = parseInput(idSchema, clinicId);
    const d = parseInput(markSickSchema.shape.localDate, date);
    if (a.clinicId !== cid) throw gqlError('FORBIDDEN', 'This is not your clinic');
    const now = this.domain.now();
    const r = await rows(this.db, sql`SELECT ${sql.raw(APPOINTMENT_COLUMNS)} FROM appointments a WHERE a.clinic_id = ${cid}::uuid AND a.local_date = ${d}::date AND a.status <> 'held' ORDER BY a.starts_at LIMIT 500`);
    return r.map((x) => appointmentFromSql(x, now));
  }

  @Roles('doctor') @Query(() => [AppointmentType])
  async doctorSchedule(@Args('fromDate', { type: () => String }) fromDate: string, @Args('days', { type: () => Int, defaultValue: 7 }) days: number, @Context() c: GqlContext) {
    const a = actorOf(c);
    if (!a.doctorId) return [];
    const from = parseInput(markSickSchema.shape.localDate, fromDate);
    const to = addDays(from, Math.min(Math.max(days, 1), 14) - 1);
    const now = this.domain.now();
    const r = await rows(this.db, sql`SELECT ${sql.raw(APPOINTMENT_COLUMNS)} FROM appointments a WHERE a.doctor_id = ${a.doctorId}::uuid AND a.local_date BETWEEN ${from}::date AND ${to}::date AND a.status <> 'held' ORDER BY a.starts_at LIMIT 500`);
    return r.map((x) => appointmentFromSql(x, now));
  }

  /** Registrar: find a patient to book by phone. Exact phone anywhere; names only among the clinic's own patients. */
  @Roles('registrar') @Query(() => [PatientType])
  async searchPatients(@Args('query', { type: () => String }) query: string, @Context() c: GqlContext): Promise<PatientType[]> {
    const a = actorOf(c);
    const q = query.trim().slice(0, 100);
    if (q.length < 2) return [];
    const phone = phoneSchema.safeParse(q);
    const r = phone.success
      ? await rows(this.db, sql`SELECT id, full_name, phone, email, online_booking_blocked_until FROM patients WHERE phone = ${phone.data} LIMIT 1`)
      : await rows(this.db, sql`
          SELECT DISTINCT p.id, p.full_name, p.phone, p.email, p.online_booking_blocked_until FROM patients p
          WHERE p.full_name ILIKE ${q.replace(/[%_\\]/g, '\\$&') + '%'}
            AND EXISTS (SELECT 1 FROM appointments x WHERE x.patient_id = p.id AND x.clinic_id = ${a.clinicId}::uuid)
          ORDER BY p.full_name LIMIT 20`);
    return r.map((x) => ({ id: String(x['id']), fullName: String(x['full_name']), phone: String(x['phone']), email: x['email'] ? String(x['email']) : null, onlineBookingBlockedUntil: x['online_booking_blocked_until'] ? new Date(String(x['online_booking_blocked_until'])) : null, visits: [] }));
  }
}

// =============== waiting list ===============
@Resolver(() => WaitlistEntryType)
export class WaitlistFieldResolver {
  @ResolveField(() => DoctorType)
  doctor(@Parent() e: WaitlistEntryType, @Context() c: GqlContext) {
    return c.loaders.doctor.load(e.doctorId);
  }
  @ResolveField(() => ServiceType)
  service(@Parent() e: WaitlistEntryType, @Context() c: GqlContext) {
    return c.loaders.service.load(e.serviceId);
  }
}

@Resolver(() => WaitlistOfferType)
export class OfferFieldResolver {
  constructor(@Inject(DB) private readonly db: Db) {}
  @ResolveField(() => AppointmentType, { nullable: true })
  appointment(@Parent() o: WaitlistOfferType, @Context() c: GqlContext) {
    return loadVisible(this.db, o.appointmentId, c.actor);
  }
}

@Resolver()
export class WaitlistResolver {
  constructor(@Inject(DB) private readonly db: Db, @Inject(DOMAIN) private readonly domain: Ctx, @Inject(BUS) private readonly bus: EventBus) {}

  @Roles('patient') @Query(() => [WaitlistEntryType])
  async myWaitlist(@Context() c: GqlContext) {
    const a = actorOf(c);
    if (!a.patientId) return [];
    const r = await rows(this.db, sql`SELECT id, doctor_id, service_id, from_date::text AS from_date, to_date::text AS to_date, priority, status, created_at FROM waitlist_entries WHERE patient_id = ${a.patientId}::uuid AND status = 'active' ORDER BY created_at LIMIT 20`);
    return r.map((x) => ({ id: String(x['id']), doctorId: String(x['doctor_id']), serviceId: String(x['service_id']), fromDate: String(x['from_date']), toDate: String(x['to_date']), priority: Number(x['priority']), status: String(x['status']), createdAt: new Date(String(x['created_at'])) }));
  }

  @Roles('patient') @Query(() => [WaitlistOfferType])
  async myOffers(@Context() c: GqlContext) {
    const a = actorOf(c);
    if (!a.patientId) return [];
    const now = this.domain.now();
    const r = await rows(this.db, sql`
      SELECT o.id, o.status, o.expires_at, o.appointment_id FROM waitlist_offers o
      JOIN waitlist_entries e ON e.id = o.entry_id
      WHERE e.patient_id = ${a.patientId}::uuid AND o.status = 'pending' AND o.expires_at > ${now.toISOString()}::timestamptz
      ORDER BY o.expires_at LIMIT 20`);
    return r.map((x) => ({ id: String(x['id']), status: String(x['status']), expiresAt: new Date(String(x['expires_at'])), appointmentId: String(x['appointment_id']) }));
  }

  @Roles('patient') @Mutation(() => WaitlistEntryType)
  async joinWaitlist(@Args('input', { type: () => JoinWaitlistInput }) input: JoinWaitlistInput, @Context() c: GqlContext) {
    const v = parseInput(joinWaitlistSchema, input);
    const e = unwrap(await joinWaitlist(this.domain, actorOf(c), v));
    return { id: e.id, doctorId: e.doctorId, serviceId: e.serviceId, fromDate: e.fromDate, toDate: e.toDate, priority: e.priority, status: e.status, createdAt: e.createdAt };
  }

  @Roles('patient') @Mutation(() => Boolean)
  async leaveWaitlist(@Args('id', { type: () => ID }) id: string, @Context() c: GqlContext) {
    unwrap(await leaveWaitlist(this.domain, actorOf(c), parseInput(idSchema, id)));
    return true;
  }

  @Roles('patient') @Mutation(() => AppointmentType)
  async acceptOffer(@Args('input', { type: () => RespondOfferInput }) input: RespondOfferInput, @Context() c: GqlContext) {
    const v = parseInput(respondOfferSchema.pick({ offerId: true }), input);
    const key = input.idempotencyKey ?? `accept-${v.offerId}`;
    const a = unwrap(await acceptOffer(this.domain, actorOf(c), { offerId: v.offerId, idempotencyKey: parseInput(confirmBookingSchema.shape.idempotencyKey, key) }));
    await this.bus.publish({ type: 'availability', clinicId: a.clinicId, doctorId: a.doctorId, localDate: a.localDate });
    await this.bus.publish({ type: 'appointment', appointmentId: a.id, patientId: a.patientId, clinicId: a.clinicId, doctorId: a.doctorId });
    return toAppointment(a);
  }

  @Roles('patient') @Mutation(() => Boolean)
  async declineOffer(@Args('id', { type: () => ID }) id: string, @Context() c: GqlContext) {
    const oid = parseInput(idSchema, id);
    const r = unwrap(await declineOffer(this.domain, actorOf(c), oid));
    if (r.next) {
      const x = (await rows(this.db, sql`SELECT id, patient_id, clinic_id, doctor_id FROM appointments WHERE id = ${r.next.appointmentId}::uuid`))[0];
      if (x) await this.bus.publish({ type: 'appointment', appointmentId: String(x['id']), patientId: String(x['patient_id']), clinicId: String(x['clinic_id']), doctorId: String(x['doctor_id']) });
    }
    return true;
  }
}

// =============== notifications ===============
@Resolver()
export class NotificationResolver {
  constructor(@Inject(DB) private readonly db: Db) {}
  @Roles() @Query(() => [NotificationType])
  async myNotifications(@Args('limit', { type: () => Int, nullable: true }) limit: number | null, @Context() c: GqlContext) {
    const r = await rows(this.db, sql`SELECT id, kind, payload, created_at, read_at FROM notifications WHERE user_id = ${actorOf(c).userId}::uuid ORDER BY created_at DESC LIMIT ${limitArg(limit, 30)}`);
    return r.map((x) => ({ id: String(x['id']), kind: String(x['kind']), createdAt: new Date(String(x['created_at'])), readAt: x['read_at'] ? new Date(String(x['read_at'])) : null, payloadJson: JSON.stringify(x['payload']) }));
  }
  @Roles() @Mutation(() => Int)
  async markNotificationsRead(@Context() c: GqlContext) {
    const r = await this.db.execute(sql`UPDATE notifications SET read_at = now() WHERE user_id = ${actorOf(c).userId}::uuid AND read_at IS NULL`);
    return r.rowCount ?? 0;
  }
}

// =============== registrar: schedule + sick day ===============
@Resolver()
export class StaffResolver {
  constructor(@Inject(DB) private readonly db: Db, @Inject(DOMAIN) private readonly domain: Ctx, @Inject(BUS) private readonly bus: EventBus) {}

  @Roles('registrar') @Query(() => DoctorScheduleType)
  async doctorWeeklySchedule(@Args('doctorId', { type: () => ID }) doctorId: string, @Context() c: GqlContext): Promise<DoctorScheduleType> {
    const a = actorOf(c);
    const did = parseInput(idSchema, doctorId);
    const works = await rows(this.db, sql`SELECT 1 FROM schedule_templates WHERE doctor_id = ${did}::uuid AND clinic_id = ${a.clinicId}::uuid LIMIT 1`);
    if (works.length === 0) throw gqlError('NOT_FOUND', 'The doctor does not work in your clinic');
    const t = await rows(this.db, sql`SELECT doctor_id, clinic_id, weekday, start_local::text, end_local::text, break_start_local::text, break_end_local::text FROM schedule_templates WHERE doctor_id = ${did}::uuid AND clinic_id = ${a.clinicId}::uuid ORDER BY weekday`);
    const e = await rows(this.db, sql`SELECT doctor_id, local_date::text, kind, clinic_id, start_local::text, end_local::text FROM schedule_exceptions WHERE doctor_id = ${did}::uuid AND local_date >= (now() - interval '1 day')::date AND (clinic_id IS NULL OR clinic_id = ${a.clinicId}::uuid) ORDER BY local_date LIMIT 200`);
    return {
      doctorId: did,
      templates: t.map((x) => ({ doctorId: String(x['doctor_id']), clinicId: String(x['clinic_id']), weekday: Number(x['weekday']), startLocal: String(x['start_local']).slice(0, 5), endLocal: String(x['end_local']).slice(0, 5), breakStartLocal: x['break_start_local'] ? String(x['break_start_local']).slice(0, 5) : null, breakEndLocal: x['break_end_local'] ? String(x['break_end_local']).slice(0, 5) : null })),
      exceptions: e.map((x) => ({ doctorId: String(x['doctor_id']), localDate: String(x['local_date']), kind: String(x['kind']) as DoctorScheduleType['exceptions'][number]['kind'], clinicId: x['clinic_id'] ? String(x['clinic_id']) : null, startLocal: x['start_local'] ? String(x['start_local']).slice(0, 5) : null, endLocal: x['end_local'] ? String(x['end_local']).slice(0, 5) : null })),
    };
  }

  @Roles('registrar') @Mutation(() => Boolean)
  async setScheduleTemplate(@Args('input', { type: () => TemplateInput }) input: TemplateInput, @Context() c: GqlContext) {
    const v = parseInput(scheduleTemplateSchema, input);
    unwrap(await setScheduleTemplate(this.domain, actorOf(c), v));
    return true;
  }
  @Roles('registrar') @Mutation(() => Boolean)
  async removeScheduleTemplate(@Args('input', { type: () => RemoveTemplateInput }) input: RemoveTemplateInput, @Context() c: GqlContext) {
    const v = parseInput(z.object({ doctorId: idSchema, clinicId: idSchema, weekday: z.number().int().min(1).max(7) }), input);
    unwrap(await removeScheduleTemplate(this.domain, actorOf(c), v));
    return true;
  }
  @Roles('registrar') @Mutation(() => Boolean)
  async setScheduleException(@Args('input', { type: () => ExceptionInput }) input: ExceptionInput, @Context() c: GqlContext) {
    const clean = Object.fromEntries(Object.entries(input).filter(([, x]) => x !== null));
    const v = parseInput(scheduleExceptionSchema, clean);
    unwrap(await setScheduleException(this.domain, actorOf(c), v));
    await this.bus.publish({ type: 'availability', clinicId: actorOf(c).clinicId ?? '00000000-0000-4000-8000-000000000000', doctorId: v.doctorId, localDate: v.localDate });
    return true;
  }
  @Roles('registrar') @Mutation(() => Boolean)
  async removeScheduleException(@Args('input', { type: () => RemoveExceptionInput }) input: RemoveExceptionInput, @Context() c: GqlContext) {
    const v = parseInput(markSickSchema, input);
    unwrap(await removeScheduleException(this.domain, actorOf(c), v));
    return true;
  }

  /** The doctor is ill on a date: every visit that day is cancelled, patients are emailed, repeating changes nothing. */
  @Roles('registrar') @Mutation(() => SickResultType)
  async markDoctorSick(@Args('input', { type: () => MarkSickInput }) input: MarkSickInput, @Context() c: GqlContext) {
    const v = parseInput(markSickSchema, input);
    const r = unwrap(await markDoctorSick(this.domain, actorOf(c), v));
    await this.bus.publish({ type: 'availability', clinicId: actorOf(c).clinicId ?? '00000000-0000-4000-8000-000000000000', doctorId: v.doctorId, localDate: v.localDate });
    return r;
  }
}

// =============== manager: report ===============
@Resolver()
export class ReportResolver {
  constructor(@Inject(DB) private readonly db: Db) {}
  @Roles('manager') @Query(() => ReportType)
  async report(@Args('from', { type: () => String }) from: string, @Args('to', { type: () => String }) to: string, @Args('clinicId', { type: () => ID, nullable: true }) clinicId: string | null): Promise<ReportType> {
    const p = parseInput(reportPeriodSchema, { from, to, ...(clinicId ? { clinicId } : {}) });
    const r = await loadReport(this.db, p);
    return { from: p.from, to: p.to, ...r, revenue: r.revenue.map((x) => ({ ...x, currency: x.currency as CurrencyEnum })) };
  }
}

// =============== live subscriptions ===============
const payloadOf = (p: unknown): ClinicEvent | null => (p && typeof p === 'object' && 'type' in p ? (p as ClinicEvent) : null);

@Resolver()
export class SubscriptionResolver {
  constructor(@Inject(BUS) private readonly bus: EventBus, @Inject(DB) private readonly db: Db) {}

  /** The public grid: only ids and a date, no personal data. Anyone may watch a clinic. */
  @Public()
  @Subscription(() => AvailabilityEventType, {
    filter: (p: unknown, v: { clinicId: string; doctorId?: string | null }) => {
      const e = payloadOf(p);
      return !!e && e.type === 'availability' && e.clinicId === v.clinicId && (!v.doctorId || e.doctorId === v.doctorId);
    },
    resolve: (p: ClinicEvent) => p,
  })
  availabilityChanged(@Args('clinicId', { type: () => ID }) clinicId: string, @Args('doctorId', { type: () => ID, nullable: true }) _doctorId?: string) {
    parseInput(idSchema, clinicId);
    return this.bus.pubsub.asyncIterableIterator(TOPIC);
  }

  /** A patient's own visits: events for other patients are dropped before they reach this subscriber. */
  @Roles('patient')
  @Subscription(() => AppointmentType, {
    nullable: true,
    filter: (p: unknown, _v: unknown, c: GqlContext) => {
      const e = payloadOf(p);
      return !!e && e.type === 'appointment' && !!c.actor?.patientId && e.patientId === c.actor.patientId;
    },
    resolve: (p: ClinicEvent, _a: unknown, c: GqlContext) => (p.type === 'appointment' ? c.visible(p.appointmentId) : null),
  })
  myAppointmentChanged() {
    return this.bus.pubsub.asyncIterableIterator(TOPIC);
  }

  /** Registrar: the live board of their own clinic only; asking for another clinic is refused at subscribe time. */
  @Roles('registrar')
  @Subscription(() => AppointmentType, {
    nullable: true,
    filter: (p: unknown, v: { clinicId: string }, c: GqlContext) => {
      const e = payloadOf(p);
      return !!e && e.type === 'appointment' && e.clinicId === v.clinicId && c.actor?.clinicId === e.clinicId;
    },
    resolve: (p: ClinicEvent, _a: unknown, c: GqlContext) => (p.type === 'appointment' ? c.visible(p.appointmentId) : null),
  })
  clinicAppointmentChanged(@Args('clinicId', { type: () => ID }) clinicId: string, @Context() c: GqlContext) {
    const id = parseInput(idSchema, clinicId);
    if (c.actor?.clinicId !== id) throw gqlError('FORBIDDEN', 'This is not your clinic');
    return this.bus.pubsub.asyncIterableIterator(TOPIC);
  }

  @Roles('doctor')
  @Subscription(() => AppointmentType, {
    nullable: true,
    filter: (p: unknown, _v: unknown, c: GqlContext) => {
      const e = payloadOf(p);
      return !!e && e.type === 'appointment' && !!c.actor?.doctorId && e.doctorId === c.actor.doctorId;
    },
    resolve: (p: ClinicEvent, _a: unknown, c: GqlContext) => (p.type === 'appointment' ? c.visible(p.appointmentId) : null),
  })
  doctorAppointmentChanged() {
    return this.bus.pubsub.asyncIterableIterator(TOPIC);
  }
}

