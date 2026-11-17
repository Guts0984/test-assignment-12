CREATE TYPE "public"."appointment_kind" AS ENUM('regular', 'waitlist_offer');--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('held', 'booked', 'checked_in', 'completed', 'no_show', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('UAH', 'PLN');--> statement-breakpoint
CREATE TYPE "public"."exception_kind" AS ENUM('vacation', 'sick', 'day_off', 'extra_day', 'custom_hours');--> statement-breakpoint
CREATE TYPE "public"."locale" AS ENUM('uk', 'en', 'pl');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('pending', 'accepted', 'declined', 'expired');--> statement-breakpoint
CREATE TYPE "public"."penalty_kind" AS ENUM('no_show', 'late_cancel');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('patient', 'registrar', 'doctor', 'manager');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."waitlist_status" AS ENUM('active', 'fulfilled', 'cancelled');--> statement-breakpoint
CREATE TABLE "appointment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_role" text NOT NULL,
	"type" text NOT NULL,
	"from_status" "appointment_status",
	"to_status" "appointment_status" NOT NULL,
	"old_starts_at" timestamp with time zone,
	"new_starts_at" timestamp with time zone,
	"late" boolean DEFAULT false NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"room_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"prep_minutes" integer DEFAULT 5 NOT NULL,
	"occupied_until" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"status" "appointment_status" NOT NULL,
	"kind" "appointment_kind" DEFAULT 'regular' NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"price_minor" bigint NOT NULL,
	"currency" "currency" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"booked_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_late" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_time_chk" CHECK ("appointments"."ends_at" > "appointments"."starts_at"),
	CONSTRAINT "appointments_grid_chk" CHECK (extract(epoch from "appointments"."starts_at")::bigint % 900 = 0),
	CONSTRAINT "appointments_price_chk" CHECK ("appointments"."price_minor" >= 0),
	CONSTRAINT "appointments_hold_chk" CHECK ("appointments"."status" <> 'held' OR "appointments"."hold_expires_at" IS NOT NULL),
	CONSTRAINT "appointments_prep_chk" CHECK ("appointments"."prep_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "clinic_services" (
	"clinic_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"price_minor" bigint NOT NULL,
	CONSTRAINT "clinic_services_clinic_id_service_id_pk" PRIMARY KEY("clinic_id","service_id"),
	CONSTRAINT "clinic_services_price_chk" CHECK ("clinic_services"."price_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "clinics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"city" text NOT NULL,
	"time_zone" text NOT NULL,
	"currency" "currency" NOT NULL,
	CONSTRAINT "clinics_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "doctor_services" (
	"doctor_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	CONSTRAINT "doctor_services_doctor_id_service_id_pk" PRIMARY KEY("doctor_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "doctors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"specialty" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"actor_key" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"appointment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_actor_key_key_pk" PRIMARY KEY("actor_key","key")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"locale" "locale" DEFAULT 'uk' NOT NULL,
	"online_booking_blocked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patients_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "patients_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "penalty_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"kind" "penalty_kind" NOT NULL,
	"appointment_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"kind" text DEFAULT 'ultrasound' NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"kind" "exception_kind" NOT NULL,
	"clinic_id" uuid,
	"start_local" time,
	"end_local" time,
	"break_start_local" time,
	"break_end_local" time,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_exceptions_hours_chk" CHECK (("schedule_exceptions"."kind" NOT IN ('extra_day','custom_hours')) OR ("schedule_exceptions"."start_local" IS NOT NULL AND "schedule_exceptions"."end_local" IS NOT NULL AND "schedule_exceptions"."clinic_id" IS NOT NULL AND "schedule_exceptions"."start_local" < "schedule_exceptions"."end_local"))
);
--> statement-breakpoint
CREATE TABLE "schedule_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_local" time NOT NULL,
	"end_local" time NOT NULL,
	"break_start_local" time,
	"break_end_local" time,
	CONSTRAINT "schedule_templates_weekday_chk" CHECK ("schedule_templates"."weekday" BETWEEN 1 AND 7),
	CONSTRAINT "schedule_templates_hours_chk" CHECK ("schedule_templates"."start_local" < "schedule_templates"."end_local"),
	CONSTRAINT "schedule_templates_break_chk" CHECK (("schedule_templates"."break_start_local" IS NULL AND "schedule_templates"."break_end_local" IS NULL) OR ("schedule_templates"."break_start_local" IS NOT NULL AND "schedule_templates"."break_end_local" IS NOT NULL AND "schedule_templates"."start_local" <= "schedule_templates"."break_start_local" AND "schedule_templates"."break_start_local" < "schedule_templates"."break_end_local" AND "schedule_templates"."break_end_local" <= "schedule_templates"."end_local"))
);
--> statement-breakpoint
CREATE TABLE "scheduled_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone,
	CONSTRAINT "scheduled_tasks_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "seed_runs" (
	"name" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"specialty" text NOT NULL,
	"name_uk" text NOT NULL,
	"name_en" text NOT NULL,
	"name_pl" text NOT NULL,
	"duration_min" integer NOT NULL,
	"needs_ultrasound" boolean DEFAULT false NOT NULL,
	CONSTRAINT "services_code_unique" UNIQUE("code"),
	CONSTRAINT "services_duration_chk" CHECK ("services"."duration_min" BETWEEN 15 AND 90 AND "services"."duration_min" % 15 = 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" NOT NULL,
	"clinic_id" uuid,
	"doctor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_registrar_clinic_chk" CHECK ("users"."role" <> 'registrar' OR "users"."clinic_id" IS NOT NULL),
	CONSTRAINT "users_doctor_chk" CHECK ("users"."role" <> 'doctor' OR "users"."doctor_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "waitlist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"priority" smallint DEFAULT 0 NOT NULL,
	"status" "waitlist_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_range_chk" CHECK ("waitlist_entries"."from_date" <= "waitlist_entries"."to_date")
);
--> statement-breakpoint
CREATE TABLE "waitlist_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "offer_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_services" ADD CONSTRAINT "clinic_services_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_services" ADD CONSTRAINT "clinic_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_services" ADD CONSTRAINT "doctor_services_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_services" ADD CONSTRAINT "doctor_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "penalty_events" ADD CONSTRAINT "penalty_events_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "penalty_events" ADD CONSTRAINT "penalty_events_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_templates" ADD CONSTRAINT "schedule_templates_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_templates" ADD CONSTRAINT "schedule_templates_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_offers" ADD CONSTRAINT "waitlist_offers_entry_id_waitlist_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."waitlist_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_offers" ADD CONSTRAINT "waitlist_offers_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointment_events_appt_idx" ON "appointment_events" USING btree ("appointment_id","at");--> statement-breakpoint
CREATE INDEX "appointments_doctor_starts_idx" ON "appointments" USING btree ("doctor_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_clinic_starts_idx" ON "appointments" USING btree ("clinic_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_patient_starts_idx" ON "appointments" USING btree ("patient_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_held_expiry_idx" ON "appointments" USING btree ("hold_expires_at") WHERE "appointments"."status" = 'held';--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_patient_doctor_day_uq" ON "appointments" USING btree ("patient_id","doctor_id","local_date") WHERE "appointments"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "doctor_services_service_idx" ON "doctor_services" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "penalty_events_appt_uq" ON "penalty_events" USING btree ("appointment_id","kind");--> statement-breakpoint
CREATE INDEX "penalty_events_patient_idx" ON "penalty_events" USING btree ("patient_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_clinic_kind_uq" ON "rooms" USING btree ("clinic_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_exceptions_doctor_date_uq" ON "schedule_exceptions" USING btree ("doctor_id","local_date");--> statement-breakpoint
CREATE INDEX "schedule_exceptions_date_idx" ON "schedule_exceptions" USING btree ("local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_templates_doctor_weekday_uq" ON "schedule_templates" USING btree ("doctor_id","weekday");--> statement-breakpoint
CREATE INDEX "schedule_templates_clinic_idx" ON "schedule_templates" USING btree ("clinic_id","weekday");--> statement-breakpoint
CREATE INDEX "scheduled_tasks_due_idx" ON "scheduled_tasks" USING btree ("run_at") WHERE "scheduled_tasks"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "waitlist_queue_idx" ON "waitlist_entries" USING btree ("doctor_id","priority" DESC NULLS LAST,"created_at") WHERE "waitlist_entries"."status" = 'active';--> statement-breakpoint
CREATE INDEX "waitlist_patient_idx" ON "waitlist_entries" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "waitlist_offers_entry_idx" ON "waitlist_offers" USING btree ("entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_offers_appt_pending_uq" ON "waitlist_offers" USING btree ("appointment_id") WHERE "waitlist_offers"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "waitlist_offers_created_idx" ON "waitlist_offers" USING btree ("created_at");