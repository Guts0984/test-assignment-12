import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verify } from '@node-rs/argon2';
import { sql } from 'drizzle-orm';
import { generateSeed, loadDbEnv, runSeed, type DbEnv } from '../src/index.js';
import { createTestDb, type TestDb } from './helpers.js';

const PASSWORD = 'demo-password-1';
const envFor = (url: string, over: Record<string, string> = {}): DbEnv =>
  loadDbEnv({
    DATABASE_URL: url,
    SEED_PASSWORD: PASSWORD,
    SEED_DOCTORS: '12',
    SEED_PATIENTS: '600',
    SEED_APPOINTMENTS: '4000',
    SEED_PAST_DAYS: '60',
    SEED_FUTURE_DAYS: '30',
    SEED_NOW: '2026-06-15T10:00:00Z',
    ...over,
  });
const NOW = '2026-06-15T10:00:00Z';

let t: TestDb;
let q: <T = Record<string, unknown>>(s: ReturnType<typeof sql>) => Promise<T[]>;

beforeAll(async () => {
  t = await createTestDb();
  q = async (s) => (await t.db.execute(s)).rows as never;
  await runSeed(t.pool, envFor(t.url));
});
afterAll(async () => {
  await t.drop();
});

const count = async (table: string): Promise<number> =>
  Number(((await q(sql.raw(`SELECT count(*)::int AS n FROM ${table}`)))[0] as { n: number }).n);

describe('seed shape', () => {
  it('has exactly the requested counts', async () => {
    expect(await count('appointments')).toBe(4000);
    expect(await count('patients')).toBe(600);
    expect(await count('doctors')).toBe(12);
    expect(await count('clinics')).toBe(3);
    expect(await count('services')).toBe(15);
    expect(await count('rooms')).toBe(3);
  });
  it('3 services need the ultrasound room, durations are 15..90 in steps of 15', async () => {
    const r = await q<{ u: number; bad: number }>(sql`SELECT count(*) FILTER (WHERE needs_ultrasound)::int AS u, count(*) FILTER (WHERE duration_min NOT BETWEEN 15 AND 90 OR duration_min % 15 <> 0)::int AS bad FROM services`);
    expect(r[0]).toEqual({ u: 3, bad: 0 });
  });
  it('some doctors work in two clinics on different days, none in two clinics on one day', async () => {
    const two = await q<{ n: number }>(sql`SELECT count(*)::int AS n FROM (SELECT doctor_id FROM schedule_templates GROUP BY doctor_id HAVING count(DISTINCT clinic_id) > 1) x`);
    expect(two[0]?.n).toBeGreaterThan(0);
    const dup = await q<{ n: number }>(sql`SELECT count(*)::int AS n FROM (SELECT doctor_id, weekday FROM schedule_templates GROUP BY 1,2 HAVING count(*) > 1) x`);
    expect(dup[0]?.n).toBe(0);
  });
  it('has exceptions of every kind', async () => {
    const kinds = await q<{ kind: string }>(sql`SELECT DISTINCT kind FROM schedule_exceptions`);
    expect(kinds.map((k) => k.kind).sort()).toEqual(['custom_hours', 'day_off', 'extra_day', 'sick', 'vacation']);
  });
  it('covers the past window and 30 days ahead, but not beyond', async () => {
    const r = await q<{ lo: string; hi: string }>(sql`SELECT min(starts_at) AS lo, max(starts_at) AS hi FROM appointments`);
    const lo = new Date(String(r[0]?.lo)).getTime();
    const hi = new Date(String(r[0]?.hi)).getTime();
    const now = new Date(NOW).getTime();
    expect(now - lo).toBeLessThanOrEqual(61 * 86_400_000);
    expect(hi - now).toBeLessThanOrEqual(31 * 86_400_000);
    expect(hi).toBeGreaterThan(now + 20 * 86_400_000);
  });
});

describe('seed obeys the business rules (not just the constraints)', () => {
  it('no patient has more than 3 future live visits', async () => {
    const r = await q<{ m: number | null }>(sql`SELECT max(c)::int AS m FROM (SELECT count(*) c FROM appointments WHERE status IN ('held','booked','checked_in') AND starts_at > ${NOW}::timestamptz GROUP BY patient_id) x`);
    expect(Number(r[0]?.m ?? 0)).toBeLessThanOrEqual(3);
  });
  it('live visits sit inside the working hours, outside the break, on working days', async () => {
    const bad = await q<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM appointments a
      JOIN clinics c ON c.id = a.clinic_id
      LEFT JOIN schedule_exceptions e ON e.doctor_id = a.doctor_id AND e.local_date = a.local_date
      LEFT JOIN schedule_templates t ON t.doctor_id = a.doctor_id AND t.weekday = extract(isodow FROM a.local_date)::int AND t.clinic_id = a.clinic_id
      WHERE a.status <> 'cancelled'
        AND NOT (
          CASE
            WHEN e.id IS NOT NULL AND e.kind IN ('extra_day','custom_hours') THEN
              e.clinic_id = a.clinic_id
              AND (a.starts_at AT TIME ZONE c.time_zone)::time >= e.start_local
              AND (a.ends_at AT TIME ZONE c.time_zone)::time <= e.end_local
            WHEN e.id IS NOT NULL THEN false
            ELSE t.id IS NOT NULL
              AND (a.starts_at AT TIME ZONE c.time_zone)::time >= t.start_local
              AND (a.ends_at AT TIME ZONE c.time_zone)::time <= t.end_local
              AND NOT (t.break_start_local IS NOT NULL
                       AND (a.starts_at AT TIME ZONE c.time_zone)::time < t.break_end_local
                       AND (a.ends_at AT TIME ZONE c.time_zone)::time > t.break_start_local)
          END)`);
    expect(bad[0]?.n).toBe(0);
  });
  it('nothing live on vacation / sick / day-off dates', async () => {
    const r = await q<{ n: number }>(sql`SELECT count(*)::int AS n FROM appointments a JOIN schedule_exceptions e ON e.doctor_id = a.doctor_id AND e.local_date = a.local_date WHERE a.status <> 'cancelled' AND e.kind IN ('vacation','sick','day_off')`);
    expect(r[0]?.n).toBe(0);
  });
  it('rooms are set exactly for ultrasound services; prep time and currency are right', async () => {
    const r = await q<{ roomBad: number; prepBad: number; curBad: number; uzi: number }>(sql`
      SELECT count(*) FILTER (WHERE (s.needs_ultrasound) <> (a.room_id IS NOT NULL))::int AS "roomBad",
             count(*) FILTER (WHERE a.occupied_until - a.ends_at <> interval '5 minutes')::int AS "prepBad",
             count(*) FILTER (WHERE a.currency <> c.currency)::int AS "curBad",
             count(*) FILTER (WHERE s.needs_ultrasound AND a.status <> 'cancelled')::int AS uzi
      FROM appointments a JOIN services s ON s.id = a.service_id JOIN clinics c ON c.id = a.clinic_id`);
    expect(r[0]).toMatchObject({ roomBad: 0, prepBad: 0, curBad: 0 });
    expect(r[0]?.uzi).toBeGreaterThan(0);
  });
  it('prices match clinic_services; money is integers in the clinic currency', async () => {
    const r = await q<{ n: number }>(sql`SELECT count(*)::int AS n FROM appointments a JOIN clinic_services cs ON cs.clinic_id = a.clinic_id AND cs.service_id = a.service_id WHERE a.price_minor <> cs.price_minor`);
    expect(r[0]?.n).toBe(0);
  });
  it('late-cancel flag is consistent with the 24h rule', async () => {
    const r = await q<{ n: number }>(sql`SELECT count(*)::int AS n FROM appointments WHERE status = 'cancelled' AND booked_at IS NOT NULL AND cancelled_late <> (starts_at - cancelled_at < interval '24 hours')`);
    expect(r[0]?.n).toBe(0);
  });
  it('no live visit is a hold; every cancelled row has a cancel time; time travel is impossible', async () => {
    const r = await q<{ held: number; noCancelTime: number; cancelBeforeBook: number; bookedAfterNow: number }>(sql`
      SELECT count(*) FILTER (WHERE status = 'held')::int AS held,
             count(*) FILTER (WHERE status = 'cancelled' AND cancelled_at IS NULL)::int AS "noCancelTime",
             count(*) FILTER (WHERE cancelled_at < booked_at)::int AS "cancelBeforeBook",
             count(*) FILTER (WHERE booked_at > ${NOW}::timestamptz)::int AS "bookedAfterNow"
      FROM appointments`);
    expect(r[0]).toEqual({ held: 0, noCancelTime: 0, cancelBeforeBook: 0, bookedAfterNow: 0 });
  });
  it('past visits are finished, future ones are booked', async () => {
    const r = await q<{ pastBooked: number; futureDone: number }>(sql`
      SELECT count(*) FILTER (WHERE starts_at < ${NOW}::timestamptz AND status = 'booked')::int AS "pastBooked",
             count(*) FILTER (WHERE starts_at > ${NOW}::timestamptz AND status IN ('completed','no_show','checked_in'))::int AS "futureDone"
      FROM appointments`);
    expect(r[0]).toEqual({ pastBooked: 0, futureDone: 0 });
  });
});

describe('history and penalties', () => {
  it('every appointment has history that ends in its current status', async () => {
    const r = await q<{ noHistory: number; mismatch: number }>(sql`
      SELECT count(*) FILTER (WHERE last.to_status IS NULL)::int AS "noHistory",
             count(*) FILTER (WHERE last.to_status IS NOT NULL AND last.to_status <> a.status)::int AS mismatch
      FROM appointments a
      LEFT JOIN LATERAL (SELECT to_status FROM appointment_events e WHERE e.appointment_id = a.id ORDER BY at DESC, id LIMIT 1) last ON true`);
    expect(r[0]).toEqual({ noHistory: 0, mismatch: 0 });
  });
  it('blocked patients really have 2 penalties within 90 days; the unblocked do not qualify', async () => {
    const wrong = await q<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM patients p
      WHERE p.online_booking_blocked_until > ${NOW}::timestamptz
        AND NOT EXISTS (
          SELECT 1 FROM penalty_events a JOIN penalty_events b ON b.patient_id = a.patient_id AND b.at > a.at AND b.at - a.at <= interval '90 days'
          WHERE a.patient_id = p.id)`);
    expect(wrong[0]?.n).toBe(0);
    const missed = await q<{ n: number }>(sql`
      SELECT count(DISTINCT b.patient_id)::int AS n FROM penalty_events a JOIN penalty_events b
        ON b.patient_id = a.patient_id AND b.at > a.at AND b.at - a.at <= interval '90 days'
      JOIN patients p ON p.id = b.patient_id
      WHERE b.at + interval '30 days' > ${NOW}::timestamptz AND b.at <= ${NOW}::timestamptz
        AND (p.online_booking_blocked_until IS NULL OR p.online_booking_blocked_until < b.at + interval '30 days')`);
    expect(missed[0]?.n).toBe(0);
  });
  it('waitlist offers point at real appointments of kind waitlist_offer', async () => {
    const r = await q<{ n: number }>(sql`SELECT count(*)::int AS n FROM waitlist_offers o JOIN appointments a ON a.id = o.appointment_id WHERE a.kind <> 'waitlist_offer'`);
    expect(r[0]?.n).toBe(0);
  });
});

describe('logins', () => {
  it('every role has a login with the documented password, and a wrong one fails', async () => {
    for (const email of ['manager@demo.local', 'registrar.kyiv@demo.local', 'registrar.lviv@demo.local', 'registrar.warsaw@demo.local', 'doctor01@demo.local', 'doctor12@demo.local', 'patient00001@demo.local']) {
      const u = await q<{ password_hash: string }>(sql`SELECT password_hash FROM users WHERE email = ${email}`);
      expect(u, email).toHaveLength(1);
      expect(await verify(u[0]?.password_hash as string, PASSWORD), email).toBe(true);
      expect(await verify(u[0]?.password_hash as string, 'wrong-password'), email).toBe(false);
    }
  });
  it('the hash is argon2id, never the plain password', async () => {
    const u = await q<{ password_hash: string }>(sql`SELECT password_hash FROM users LIMIT 5`);
    for (const x of u) {
      expect(x.password_hash.startsWith('$argon2id$')).toBe(true);
      expect(x.password_hash).not.toContain(PASSWORD);
    }
  });
  it('doctor and registrar accounts are linked to their doctor / clinic', async () => {
    const r = await q<{ bad: number }>(sql`SELECT count(*)::int AS bad FROM users WHERE (role = 'doctor' AND doctor_id IS NULL) OR (role = 'registrar' AND clinic_id IS NULL) OR (role IN ('patient','manager') AND (doctor_id IS NOT NULL OR clinic_id IS NOT NULL))`);
    expect(r[0]?.bad).toBe(0);
  });
});

describe('seeding is safe to repeat, race, and fail', () => {
  it('a second run is a no-op', async () => {
    const before = await count('appointments');
    const r = await runSeed(t.pool, envFor(t.url));
    expect(r.skipped).toBe(true);
    expect(await count('appointments')).toBe(before);
  });

  it('two db-init containers starting together seed exactly once', async () => {
    const t2 = await createTestDb();
    try {
      const env = envFor(t2.url, { SEED_APPOINTMENTS: '800', SEED_PATIENTS: '200' });
      const [a, b, c] = await Promise.all([runSeed(t2.pool, env), runSeed(t2.pool, env), runSeed(t2.pool, env)]);
      expect([a, b, c].filter((r) => !r.skipped)).toHaveLength(1);
      const n = (await t2.db.execute(sql`SELECT count(*)::int AS n FROM appointments`)).rows[0] as { n: number };
      expect(n.n).toBe(800);
    } finally {
      await t2.drop();
    }
  });

  it('a failure half way rolls everything back and leaves no marker', async () => {
    const t3 = await createTestDb();
    try {
      await t3.db.execute(sql`INSERT INTO clinics (code, city, time_zone, currency) VALUES ('kyiv', 'x', 'Europe/Kyiv', 'UAH')`);
      await expect(runSeed(t3.pool, envFor(t3.url, { SEED_APPOINTMENTS: '300', SEED_PATIENTS: '100' }))).rejects.toThrow();
      const r = (await t3.db.execute(sql`SELECT (SELECT count(*) FROM seed_runs)::int AS marker, (SELECT count(*) FROM patients)::int AS patients, (SELECT count(*) FROM appointments)::int AS appts, (SELECT count(*) FROM clinics)::int AS clinics`)).rows[0];
      expect(r).toEqual({ marker: 0, patients: 0, appts: 0, clinics: 1 });
      // and the history trigger is still enabled afterwards
      const tg = (await t3.db.execute(sql`SELECT tgenabled FROM pg_trigger WHERE tgname = 'appointments_3_history'`)).rows[0] as { tgenabled: string };
      expect(tg.tgenabled).toBe('O');
    } finally {
      await t3.drop();
    }
  });

  it('refuses to seed without a password', async () => {
    const env = { ...envFor(t.url) } as DbEnv;
    delete (env as { SEED_PASSWORD?: string }).SEED_PASSWORD;
    await expect(runSeed(t.pool, env)).rejects.toThrow(/SEED_PASSWORD/);
  });
});

describe('generator', () => {
  const opts = { rng: 7, doctors: 6, patients: 200, appointments: 700, pastDays: 30, futureDays: 14, now: new Date(NOW), passwordHash: 'h' };
  it('is deterministic for a given seed and different for another', () => {
    const a = generateSeed(opts);
    const b = generateSeed(opts);
    const c = generateSeed({ ...opts, rng: 8 });
    expect(JSON.stringify(a.appointments)).toBe(JSON.stringify(b.appointments));
    expect(JSON.stringify(a.appointments)).not.toBe(JSON.stringify(c.appointments));
  });
  it('trims down when capacity exceeds the request and tops up with cancelled rows when it falls short', () => {
    expect(generateSeed({ ...opts, appointments: 50 }).appointments).toHaveLength(50);
    expect(generateSeed({ ...opts, appointments: 50 }).stats.cancelled).toBe(0);
    const big = generateSeed({ ...opts, appointments: 5000 });
    expect(big.appointments).toHaveLength(5000);
    expect(big.stats.cancelled).toBeGreaterThan(0);
  });
  it('unique ids and unique phones/emails', () => {
    const d = generateSeed(opts);
    const ids = new Set(d.appointments.map((r) => r[0]));
    expect(ids.size).toBe(d.appointments.length);
    expect(new Set(d.patients.map((r) => r[3])).size).toBe(d.patients.length);
    expect(new Set(d.users.map((r) => String(r[1]).toLowerCase())).size).toBe(d.users.length);
  });
});
