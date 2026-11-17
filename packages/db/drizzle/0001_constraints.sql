CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- Invariant 1: a doctor is never busy twice (visit + preparation time).
ALTER TABLE appointments ADD CONSTRAINT appointments_doctor_no_overlap
  EXCLUDE USING gist (doctor_id WITH =, tstzrange(starts_at, occupied_until) WITH &&)
  WHERE (status <> 'cancelled');
--> statement-breakpoint

-- Invariant 2: the clinic's single ultrasound room is never busy twice, whichever doctor books it.
ALTER TABLE appointments ADD CONSTRAINT appointments_room_no_overlap
  EXCLUDE USING gist (room_id WITH =, tstzrange(starts_at, occupied_until) WITH &&)
  WHERE (room_id IS NOT NULL AND status <> 'cancelled');
--> statement-breakpoint

-- Invariant 3: a patient is never in two places at once.
ALTER TABLE appointments ADD CONSTRAINT appointments_patient_no_overlap
  EXCLUDE USING gist (patient_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
  WHERE (status <> 'cancelled');
--> statement-breakpoint

CREATE INDEX appointments_local_date_cov_idx ON appointments (local_date)
  INCLUDE (status, doctor_id, clinic_id, service_id, price_minor, starts_at, ends_at, cancelled_late, booked_at);
--> statement-breakpoint
CREATE INDEX appointments_room_starts_idx ON appointments (room_id, starts_at) WHERE room_id IS NOT NULL;
--> statement-breakpoint

-- Guard: legal status transitions, frozen history, version bump on reschedule.
CREATE FUNCTION appointments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status::text, NEW.status::text) IN (
      ('held','booked'), ('held','cancelled'), ('booked','cancelled'),
      ('booked','checked_in'), ('booked','no_show'), ('checked_in','completed')
    )) THEN
      RAISE EXCEPTION 'invalid status transition % -> %', OLD.status, NEW.status
        USING ERRCODE = 'AP001';
    END IF;
  END IF;
  IF NEW.starts_at IS DISTINCT FROM OLD.starts_at THEN
    IF OLD.status NOT IN ('held', 'booked') OR NEW.status NOT IN ('held', 'booked') THEN
      RAISE EXCEPTION 'appointment in status % cannot be moved', OLD.status
        USING ERRCODE = 'AP001';
    END IF;
    NEW.version := OLD.version + 1;
  END IF;
  IF NEW.status = 'booked' AND OLD.status = 'held' AND NEW.booked_at IS NULL THEN
    NEW.booked_at := now();
  END IF;
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' AND NEW.cancelled_at IS NULL THEN
    NEW.cancelled_at := now();
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER appointments_1_guard BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION appointments_guard();
--> statement-breakpoint

-- Derived columns. The UZI room comes from service + clinic, never from the caller.
CREATE FUNCTION appointments_prepare() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tz text;
  uzi boolean;
BEGIN
  SELECT time_zone INTO tz FROM clinics WHERE id = NEW.clinic_id;
  NEW.local_date := (NEW.starts_at AT TIME ZONE tz)::date;
  NEW.occupied_until := NEW.ends_at + make_interval(mins => NEW.prep_minutes);
  SELECT needs_ultrasound INTO uzi FROM services WHERE id = NEW.service_id;
  IF uzi THEN
    SELECT id INTO NEW.room_id FROM rooms WHERE clinic_id = NEW.clinic_id AND kind = 'ultrasound';
  ELSE
    NEW.room_id := NULL;
  END IF;
  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1 FROM doctor_services WHERE doctor_id = NEW.doctor_id AND service_id = NEW.service_id
  ) THEN
    RAISE EXCEPTION 'doctor does not provide this service' USING ERRCODE = 'AP002';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER appointments_2_prepare BEFORE INSERT OR UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION appointments_prepare();
--> statement-breakpoint

-- History cannot be skipped: it is written by the database. Actor and clock come from
-- transaction-local settings (set_config('app.actor_user_id' | 'app.actor_role' | 'app.now' |
-- 'app.reason' | 'app.late', value, true)).
CREATE FUNCTION appointments_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ev text;
  at_ts timestamptz;
BEGIN
  at_ts := coalesce(nullif(current_setting('app.now', true), '')::timestamptz, now());
  IF TG_OP = 'INSERT' THEN
    ev := CASE WHEN NEW.status = 'held' THEN 'held' ELSE 'created' END;
  ELSIF NEW.starts_at IS DISTINCT FROM OLD.starts_at THEN
    ev := 'rescheduled';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    ev := CASE
      WHEN OLD.status = 'held' AND NEW.status = 'booked' THEN 'confirmed'
      ELSE NEW.status::text
    END;
  ELSE
    RETURN NEW;
  END IF;
  INSERT INTO appointment_events
    (appointment_id, at, actor_user_id, actor_role, type, from_status, to_status,
     old_starts_at, new_starts_at, late, reason)
  VALUES (
    NEW.id, at_ts,
    nullif(current_setting('app.actor_user_id', true), '')::uuid,
    coalesce(nullif(current_setting('app.actor_role', true), ''), 'system'),
    ev,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END,
    NEW.status,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.starts_at END,
    NEW.starts_at,
    coalesce(nullif(current_setting('app.late', true), '')::boolean, false),
    nullif(current_setting('app.reason', true), '')
  );
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER appointments_3_history AFTER INSERT OR UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION appointments_history();
--> statement-breakpoint

-- Expired regular holds are released lazily: a constraint cannot depend on now(), so every
-- booking transaction calls this first for the doctor / room / patient it is about to touch.
-- SKIP LOCKED: rows another transaction is already releasing are waited for by the
-- exclusion check itself, so two sweeps never deadlock.
CREATE FUNCTION release_expired_holds(
  p_now timestamptz, p_doctor uuid, p_room uuid, p_patient uuid,
  p_from timestamptz, p_to timestamptz
) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  n integer;
  old_role text := current_setting('app.actor_role', true);
  old_reason text := current_setting('app.reason', true);
  old_actor text := current_setting('app.actor_user_id', true);
BEGIN
  PERFORM set_config('app.actor_role', 'system', true);
  PERFORM set_config('app.actor_user_id', '', true);
  PERFORM set_config('app.reason', 'hold_expired', true);
  PERFORM set_config('app.now', p_now::text, true);
  WITH victims AS (
    SELECT id FROM appointments
    WHERE status = 'held' AND kind = 'regular' AND hold_expires_at <= p_now
      AND starts_at < p_to AND occupied_until > p_from
      AND (doctor_id = p_doctor OR (p_room IS NOT NULL AND room_id = p_room) OR patient_id = p_patient)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE appointments a SET status = 'cancelled', cancelled_at = p_now
  FROM victims v WHERE a.id = v.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('app.actor_role', coalesce(old_role, ''), true);
  PERFORM set_config('app.actor_user_id', coalesce(old_actor, ''), true);
  PERFORM set_config('app.reason', coalesce(old_reason, ''), true);
  RETURN n;
END $$;
--> statement-breakpoint

-- Workers wake up on new tasks; the periodic reconcile loop is the safety net.
CREATE FUNCTION scheduled_tasks_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('scheduled_tasks', NEW.id::text);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER scheduled_tasks_notify AFTER INSERT ON scheduled_tasks
  FOR EACH ROW EXECUTE FUNCTION scheduled_tasks_notify();
--> statement-breakpoint

-- History is append-only.
CREATE FUNCTION appointment_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'appointment_events is append-only' USING ERRCODE = 'AP003';
END $$;
--> statement-breakpoint
CREATE TRIGGER appointment_events_immutable BEFORE UPDATE OR DELETE ON appointment_events
  FOR EACH ROW EXECUTE FUNCTION appointment_events_immutable();
