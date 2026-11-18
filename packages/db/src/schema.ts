import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const id = () => uuid('id').primaryKey().defaultRandom();

export const roleEnum = pgEnum('role', ['patient', 'registrar', 'doctor', 'manager']);
export const currencyEnum = pgEnum('currency', ['UAH', 'PLN']);
export const localeEnum = pgEnum('locale', ['uk', 'en', 'pl']);
export const appointmentStatusEnum = pgEnum('appointment_status', [
  'held',
  'booked',
  'checked_in',
  'completed',
  'no_show',
  'cancelled',
]);
export const appointmentKindEnum = pgEnum('appointment_kind', ['regular', 'waitlist_offer']);
export const exceptionKindEnum = pgEnum('exception_kind', [
  'vacation',
  'sick',
  'day_off',
  'extra_day',
  'custom_hours',
]);
export const waitlistStatusEnum = pgEnum('waitlist_status', ['active', 'fulfilled', 'cancelled']);
export const offerStatusEnum = pgEnum('offer_status', [
  'pending',
  'accepted',
  'declined',
  'expired',
]);
export const taskStatusEnum = pgEnum('task_status', ['pending', 'done', 'cancelled']);
export const penaltyKindEnum = pgEnum('penalty_kind', ['no_show', 'late_cancel']);

export const clinics = pgTable('clinics', {
  id: id(),
  code: text('code').notNull().unique(),
  city: text('city').notNull(),
  timeZone: text('time_zone').notNull(),
  currency: currencyEnum('currency').notNull(),
});

export const rooms = pgTable(
  'rooms',
  {
    id: id(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id),
    kind: text('kind').notNull().default('ultrasound'),
    name: text('name').notNull(),
  },
  (t) => [uniqueIndex('rooms_clinic_kind_uq').on(t.clinicId, t.kind)],
);

export const services = pgTable(
  'services',
  {
    id: id(),
    code: text('code').notNull().unique(),
    specialty: text('specialty').notNull(),
    nameUk: text('name_uk').notNull(),
    nameEn: text('name_en').notNull(),
    namePl: text('name_pl').notNull(),
    durationMin: integer('duration_min').notNull(),
    needsUltrasound: boolean('needs_ultrasound').notNull().default(false),
  },
  (t) => [
    check(
      'services_duration_chk',
      sql`${t.durationMin} BETWEEN 15 AND 90 AND ${t.durationMin} % 15 = 0`,
    ),
  ],
);

export const clinicServices = pgTable(
  'clinic_services',
  {
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id),
    /** Minor units (kopiyky / grosze) in the clinic currency. */
    priceMinor: bigint('price_minor', { mode: 'number' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.clinicId, t.serviceId] }),
    check('clinic_services_price_chk', sql`${t.priceMinor} >= 0`),
  ],
);

export const doctors = pgTable('doctors', {
  id: id(),
  fullName: text('full_name').notNull(),
  specialty: text('specialty').notNull(),
});

export const doctorServices = pgTable(
  'doctor_services',
  {
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctors.id),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id),
  },
  (t) => [
    primaryKey({ columns: [t.doctorId, t.serviceId] }),
    index('doctor_services_service_idx').on(t.serviceId),
  ],
);

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: roleEnum('role').notNull(),
    clinicId: uuid('clinic_id').references(() => clinics.id),
    doctorId: uuid('doctor_id').references(() => doctors.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(sql`lower(${t.email})`),
    check('users_registrar_clinic_chk', sql`${t.role} <> 'registrar' OR ${t.clinicId} IS NOT NULL`),
    check('users_doctor_chk', sql`${t.role} <> 'doctor' OR ${t.doctorId} IS NOT NULL`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const patients = pgTable('patients', {
  id: id(),
  userId: uuid('user_id')
    .unique()
    .references(() => users.id),
  fullName: text('full_name').notNull(),
  phone: text('phone').notNull().unique(),
  email: text('email'),
  locale: localeEnum('locale').notNull().default('uk'),
  onlineBookingBlockedUntil: ts('online_booking_blocked_until'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const scheduleTemplates = pgTable(
  'schedule_templates',
  {
    id: id(),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctors.id),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id),
    weekday: smallint('weekday').notNull(),
    startLocal: time('start_local').notNull(),
    endLocal: time('end_local').notNull(),
    breakStartLocal: time('break_start_local'),
    breakEndLocal: time('break_end_local'),
  },
  (t) => [
    uniqueIndex('schedule_templates_doctor_weekday_uq').on(t.doctorId, t.weekday),
    index('schedule_templates_clinic_idx').on(t.clinicId, t.weekday),
    check('schedule_templates_weekday_chk', sql`${t.weekday} BETWEEN 1 AND 7`),
    check('schedule_templates_hours_chk', sql`${t.startLocal} < ${t.endLocal}`),
    check(
      'schedule_templates_break_chk',
      sql`(${t.breakStartLocal} IS NULL AND ${t.breakEndLocal} IS NULL) OR (${t.breakStartLocal} IS NOT NULL AND ${t.breakEndLocal} IS NOT NULL AND ${t.startLocal} <= ${t.breakStartLocal} AND ${t.breakStartLocal} < ${t.breakEndLocal} AND ${t.breakEndLocal} <= ${t.endLocal})`,
    ),
  ],
);

export const scheduleExceptions = pgTable(
  'schedule_exceptions',
  {
    id: id(),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctors.id),
    localDate: date('local_date', { mode: 'string' }).notNull(),
    kind: exceptionKindEnum('kind').notNull(),
    clinicId: uuid('clinic_id').references(() => clinics.id),
    startLocal: time('start_local'),
    endLocal: time('end_local'),
    breakStartLocal: time('break_start_local'),
    breakEndLocal: time('break_end_local'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('schedule_exceptions_doctor_date_uq').on(t.doctorId, t.localDate),
    index('schedule_exceptions_date_idx').on(t.localDate),
    check(
      'schedule_exceptions_hours_chk',
      sql`(${t.kind} NOT IN ('extra_day','custom_hours')) OR (${t.startLocal} IS NOT NULL AND ${t.endLocal} IS NOT NULL AND ${t.clinicId} IS NOT NULL AND ${t.startLocal} < ${t.endLocal})`,
    ),
  ],
);

export const appointments = pgTable(
  'appointments',
  {
    id: id(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctors.id),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id),
    /** Filled by trigger from the service + clinic: the UZI room is never trusted from the caller. */
    roomId: uuid('room_id').references(() => rooms.id),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    prepMinutes: integer('prep_minutes').notNull().default(5),
    /** Set by trigger: ends_at + prep_minutes. Doctor and room are busy until here. */
    occupiedUntil: ts('occupied_until').notNull(),
    /** Set by trigger: calendar date of starts_at in the clinic time zone. */
    localDate: date('local_date', { mode: 'string' }).notNull(),
    status: appointmentStatusEnum('status').notNull(),
    kind: appointmentKindEnum('kind').notNull().default('regular'),
    holdExpiresAt: ts('hold_expires_at'),
    priceMinor: bigint('price_minor', { mode: 'number' }).notNull(),
    currency: currencyEnum('currency').notNull(),
    version: integer('version').notNull().default(1),
    /** First time the visit became a real booking (null for holds that were never confirmed). */
    bookedAt: ts('booked_at'),
    cancelledAt: ts('cancelled_at'),
    cancelledLate: boolean('cancelled_late').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('appointments_doctor_starts_idx').on(t.doctorId, t.startsAt),
    index('appointments_clinic_starts_idx').on(t.clinicId, t.startsAt),
    index('appointments_patient_starts_idx').on(t.patientId, t.startsAt),
    // covering index appointments_local_date_cov_idx (INCLUDE) lives in the custom SQL migration
    index('appointments_held_expiry_idx')
      .on(t.holdExpiresAt)
      .where(sql`${t.status} = 'held'`),
    uniqueIndex('appointments_patient_doctor_day_uq')
      .on(t.patientId, t.doctorId, t.localDate)
      .where(sql`${t.status} <> 'cancelled'`),
    check('appointments_time_chk', sql`${t.endsAt} > ${t.startsAt}`),
    check('appointments_grid_chk', sql`extract(epoch from ${t.startsAt})::bigint % 900 = 0`),
    check('appointments_price_chk', sql`${t.priceMinor} >= 0`),
    check('appointments_hold_chk', sql`${t.status} <> 'held' OR ${t.holdExpiresAt} IS NOT NULL`),
    check('appointments_prep_chk', sql`${t.prepMinutes} >= 0`),
  ],
);

export const appointmentEvents = pgTable(
  'appointment_events',
  {
    id: id(),
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => appointments.id),
    at: ts('at').notNull().defaultNow(),
    actorUserId: uuid('actor_user_id'),
    actorRole: text('actor_role').notNull(),
    type: text('type').notNull(),
    fromStatus: appointmentStatusEnum('from_status'),
    toStatus: appointmentStatusEnum('to_status').notNull(),
    oldStartsAt: ts('old_starts_at'),
    newStartsAt: ts('new_starts_at'),
    late: boolean('late').notNull().default(false),
    reason: text('reason'),
  },
  (t) => [index('appointment_events_appt_idx').on(t.appointmentId, t.at)],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    actorKey: text('actor_key').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    appointmentId: uuid('appointment_id').references(() => appointments.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.actorKey, t.key] })],
);

export const waitlistEntries = pgTable(
  'waitlist_entries',
  {
    id: id(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctors.id),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id),
    fromDate: date('from_date', { mode: 'string' }).notNull(),
    toDate: date('to_date', { mode: 'string' }).notNull(),
    /** 1 = displaced by a sick day: served before ordinary entries. */
    priority: smallint('priority').notNull().default(0),
    status: waitlistStatusEnum('status').notNull().default('active'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('waitlist_queue_idx')
      .on(t.doctorId, t.priority.desc(), t.createdAt)
      .where(sql`${t.status} = 'active'`),
    index('waitlist_patient_idx').on(t.patientId),
    check('waitlist_range_chk', sql`${t.fromDate} <= ${t.toDate}`),
  ],
);

export const waitlistOffers = pgTable(
  'waitlist_offers',
  {
    id: id(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => waitlistEntries.id),
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => appointments.id),
    expiresAt: ts('expires_at').notNull(),
    status: offerStatusEnum('status').notNull().default('pending'),
    createdAt: ts('created_at').notNull().defaultNow(),
    respondedAt: ts('responded_at'),
  },
  (t) => [
    index('waitlist_offers_entry_idx').on(t.entryId),
    uniqueIndex('waitlist_offers_appt_pending_uq')
      .on(t.appointmentId)
      .where(sql`${t.status} = 'pending'`),
    index('waitlist_offers_created_idx').on(t.createdAt),
  ],
);

export const scheduledTasks = pgTable(
  'scheduled_tasks',
  {
    id: id(),
    kind: text('kind').notNull(),
    runAt: ts('run_at').notNull(),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    dedupeKey: text('dedupe_key').notNull().unique(),
    status: taskStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: ts('created_at').notNull().defaultNow(),
    doneAt: ts('done_at'),
  },
  (t) => [
    index('scheduled_tasks_due_idx')
      .on(t.runAt)
      .where(sql`${t.status} = 'pending'`),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind').notNull(),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: ts('created_at').notNull().defaultNow(),
    readAt: ts('read_at'),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt.desc())],
);

export const penaltyEvents = pgTable(
  'penalty_events',
  {
    id: id(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    kind: penaltyKindEnum('kind').notNull(),
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => appointments.id),
    at: ts('at').notNull(),
  },
  (t) => [
    uniqueIndex('penalty_events_appt_uq').on(t.appointmentId, t.kind),
    index('penalty_events_patient_idx').on(t.patientId, t.at),
  ],
);

export const seedRuns = pgTable('seed_runs', {
  name: text('name').primaryKey(),
  at: ts('at').notNull().defaultNow(),
});
