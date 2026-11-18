import { hash } from '@node-rs/argon2';
import type pg from 'pg';
import { copyRows } from './copy.js';
import { generateSeed, rowsOfAppointmentColumns, type SeedData } from './generate.js';
import type { DbEnv } from '../env.js';

export type { SeedData } from './generate.js';
export { generateSeed } from './generate.js';

const SEED_NAME = 'demo-v1';

export type SeedResult = { skipped: boolean; stats?: SeedData['stats'] };

/**
 * Idempotent demo seed. A `seed_runs` row is the marker; the advisory lock makes two
 * concurrent starters safe (the second waits, then sees the marker and skips).
 * Everything loads in one transaction through COPY; the real constraints stay active.
 * Only the history trigger is switched off while loading, because the seed writes
 * realistic history rows itself (with past timestamps and actors).
 */
export const runSeed = async (pool: pg.Pool, env: DbEnv): Promise<SeedResult> => {
  if (!env.SEED_PASSWORD) throw new Error('SEED_PASSWORD is required to seed');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('clinic-seed'))");
    const done = await client.query('SELECT 1 FROM seed_runs WHERE name = $1', [SEED_NAME]);
    if (done.rowCount) {
      await client.query('ROLLBACK');
      console.log('[seed] already seeded, skipping');
      return { skipped: true };
    }
    const t0 = Date.now();
    const passwordHash = await hash(env.SEED_PASSWORD);
    const data = generateSeed({
      rng: env.SEED_RNG,
      doctors: env.SEED_DOCTORS,
      patients: env.SEED_PATIENTS,
      appointments: env.SEED_APPOINTMENTS,
      pastDays: env.SEED_PAST_DAYS,
      futureDays: env.SEED_FUTURE_DAYS,
      waitlistEntries: env.SEED_WAITLIST_ENTRIES,
      now: env.SEED_NOW ? new Date(env.SEED_NOW) : new Date(),
      passwordHash,
    });
    console.log(`[seed] generated in ${Date.now() - t0} ms`, data.stats);

    await client.query('ALTER TABLE appointments DISABLE TRIGGER appointments_3_history');
    await copyRows(
      client,
      'clinics',
      ['id', 'code', 'city', 'time_zone', 'currency'],
      data.clinics,
    );
    await copyRows(client, 'rooms', ['id', 'clinic_id', 'kind', 'name'], data.rooms);
    await copyRows(
      client,
      'services',
      [
        'id',
        'code',
        'specialty',
        'name_uk',
        'name_en',
        'name_pl',
        'duration_min',
        'needs_ultrasound',
      ],
      data.services,
    );
    await copyRows(
      client,
      'clinic_services',
      ['clinic_id', 'service_id', 'price_minor'],
      data.clinicServices,
    );
    await copyRows(client, 'doctors', ['id', 'full_name', 'specialty'], data.doctors);
    await copyRows(client, 'doctor_services', ['doctor_id', 'service_id'], data.doctorServices);
    await copyRows(
      client,
      'users',
      ['id', 'email', 'password_hash', 'role', 'clinic_id', 'doctor_id'],
      data.users,
    );
    await copyRows(
      client,
      'patients',
      [
        'id',
        'user_id',
        'full_name',
        'phone',
        'email',
        'locale',
        'online_booking_blocked_until',
        'created_at',
      ],
      data.patients,
    );
    await copyRows(
      client,
      'schedule_templates',
      [
        'id',
        'doctor_id',
        'clinic_id',
        'weekday',
        'start_local',
        'end_local',
        'break_start_local',
        'break_end_local',
      ],
      data.templates,
    );
    await copyRows(
      client,
      'schedule_exceptions',
      [
        'id',
        'doctor_id',
        'local_date',
        'kind',
        'clinic_id',
        'start_local',
        'end_local',
        'break_start_local',
        'break_end_local',
      ],
      data.exceptions,
    );
    await copyRows(client, 'appointments', rowsOfAppointmentColumns, data.appointments);
    await copyRows(
      client,
      'appointment_events',
      [
        'appointment_id',
        'at',
        'actor_user_id',
        'actor_role',
        'type',
        'from_status',
        'to_status',
        'old_starts_at',
        'new_starts_at',
        'late',
        'reason',
      ],
      data.events,
    );
    await copyRows(
      client,
      'waitlist_entries',
      [
        'id',
        'patient_id',
        'doctor_id',
        'service_id',
        'from_date',
        'to_date',
        'priority',
        'status',
        'created_at',
      ],
      data.waitlistEntries,
    );
    await copyRows(
      client,
      'waitlist_offers',
      ['entry_id', 'appointment_id', 'expires_at', 'status', 'created_at', 'responded_at'],
      data.waitlistOffers,
    );
    await copyRows(
      client,
      'penalty_events',
      ['patient_id', 'kind', 'appointment_id', 'at'],
      data.penalties,
    );
    await client.query('ALTER TABLE appointments ENABLE TRIGGER appointments_3_history');
    await client.query('INSERT INTO seed_runs (name) VALUES ($1)', [SEED_NAME]);
    await client.query('COMMIT');
    await client.query('VACUUM (ANALYZE)'); // visibility map: lets the report use index-only scans
    console.log(`[seed] done in ${Date.now() - t0} ms`);
    return { skipped: false, stats: data.stats };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
};
