import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { loadAvailabilityInputs, loadDbEnv, loadReport, runMigrations, runSeed } from '../src/index.js';
import { createTestDb, type TestDb } from './helpers.js';

// Full-size seed: 3 clinics, 40 doctors, 15 services, 20 000 patients, 150 000 appointments.
let t: TestDb;
let clinicId: string;
let therapy: string;
let uzi: string;
const NOW = new Date('2026-11-17T10:00:00Z');
const day = (offset: number): string => new Date(NOW.getTime() + offset * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  t = await createTestDb();
  await runSeed(
    t.pool,
    loadDbEnv({ DATABASE_URL: t.url, SEED_PASSWORD: 'demo-password-1', SEED_NOW: NOW.toISOString() }),
  );
  const c = (await t.db.execute(sql`SELECT id FROM clinics WHERE code = 'kyiv'`)).rows[0] as { id: string };
  clinicId = c.id;
  therapy = ((await t.db.execute(sql`SELECT id FROM services WHERE code = 'therapy-consult'`)).rows[0] as { id: string }).id;
  uzi = ((await t.db.execute(sql`SELECT id FROM services WHERE code = 'gyn-uzi'`)).rows[0] as { id: string }).id;
}, 300_000);
afterAll(async () => {
  await t.drop();
});

const p95 = async (runs: number, f: () => Promise<unknown>): Promise<number> => {
  await f(); // warm
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const s = performance.now();
    await f();
    times.push(performance.now() - s);
  }
  times.sort((a, b) => a - b);
  return times[Math.ceil(runs * 0.95) - 1] as number;
};

describe('full seed', () => {
  it('has the sizes the assignment asks for', async () => {
    const r = (await t.db.execute(sql`SELECT (SELECT count(*) FROM clinics)::int c, (SELECT count(*) FROM doctors)::int d, (SELECT count(*) FROM services)::int s, (SELECT count(*) FROM patients)::int p, (SELECT count(*) FROM appointments)::int a`)).rows[0];
    expect(r).toEqual({ c: 3, d: 40, s: 15, p: 20000, a: 150000 });
  });
});

describe('query budgets on the full seed (target < 300 ms; the engine needs headroom for the grid maths)', () => {
  it('availability inputs for a service across the whole city, 14 days: p95 < 100 ms', async () => {
    const run = (serviceId: string) => () =>
      loadAvailabilityInputs(t.db, { clinicId, serviceId, windowStart: NOW, windowEnd: new Date(NOW.getTime() + 15 * 86_400_000), fromDate: day(0), toDate: day(14), now: NOW });
    expect(await p95(20, run(therapy))).toBeLessThan(100);
    expect(await p95(20, run(uzi))).toBeLessThan(100);
  });
  it('report for 90 days, whole network and one clinic: p95 < 300 ms', async () => {
    expect(await p95(15, () => loadReport(t.db, { from: day(-90), to: day(0) }))).toBeLessThan(300);
    expect(await p95(15, () => loadReport(t.db, { from: day(-90), to: day(0), clinicId }))).toBeLessThan(300);
  });
  it('the report numbers are sane on the seed', async () => {
    const r = await loadReport(t.db, { from: day(-90), to: day(0) });
    expect(r.utilization.length).toBeGreaterThan(40);
    for (const u of r.utilization) {
      expect(u.workMinutes).toBeGreaterThan(0);
      expect(u.percent).toBeGreaterThanOrEqual(0);
      expect(u.percent).toBeLessThanOrEqual(100);
    }
    expect(r.rates.bookings).toBeGreaterThan(10_000);
    expect(r.revenue.map((x) => x.currency).sort()).toContain('PLN');
    expect(r.revenue.every((x) => Number.isInteger(x.revenueMinor))).toBe(true);
  });
});

describe('the indexes are really used', () => {
  const explain = async (q: ReturnType<typeof sql>): Promise<string> =>
    (await t.db.execute(sql`EXPLAIN ${q}`)).rows.map((r) => (r as Record<string, string>)['QUERY PLAN']).join('\n');

  it('doctor busy lookup for 10 doctors x 15 days uses the (doctor, starts_at) index', async () => {
    const ids = (await t.db.execute(sql`SELECT id FROM doctors ORDER BY id LIMIT 10`)).rows.map((r) => `'${(r as { id: string }).id}'::uuid`).join(',');
    const plan = await explain(sql`SELECT doctor_id, starts_at, occupied_until FROM appointments
      WHERE doctor_id IN (${sql.raw(ids)}) AND status <> 'cancelled'
        AND starts_at < ${new Date(NOW.getTime() + 15 * 86_400_000).toISOString()}::timestamptz
        AND starts_at > ${NOW.toISOString()}::timestamptz - interval '1 day'
        AND occupied_until > ${NOW.toISOString()}::timestamptz`);
    expect(plan).not.toMatch(/Seq Scan on appointments/);
  });
  it('a one-week report slice reads the covering index only (a 90-day slice is half the table, so a scan is the right plan)', async () => {
    const plan = await explain(sql`SELECT status, count(*) FROM appointments WHERE local_date BETWEEN ${day(-7)}::date AND ${day(0)}::date GROUP BY 1`);
    expect(plan).toMatch(/Index Only Scan using appointments_local_date_cov_idx/);
  });
  it('the patient "my visits" lookup is indexed', async () => {
    const plan = await explain(sql`SELECT * FROM appointments WHERE patient_id = (SELECT id FROM patients LIMIT 1) AND starts_at > ${NOW.toISOString()}::timestamptz ORDER BY starts_at`);
    expect(plan).not.toMatch(/Seq Scan on appointments/);
  });
  it('the three invariants exist as exclusion constraints', async () => {
    const r = await t.db.execute(sql`SELECT conname FROM pg_constraint WHERE contype = 'x' AND conrelid = 'appointments'::regclass ORDER BY 1`);
    expect(r.rows.map((x) => (x as { conname: string }).conname)).toEqual([
      'appointments_doctor_no_overlap',
      'appointments_patient_no_overlap',
      'appointments_room_no_overlap',
    ]);
  });
});

describe('migrations', () => {
  it('running them again on a live, seeded database is a harmless no-op', async () => {
    const before = (await t.db.execute(sql`SELECT count(*)::int AS n FROM appointments`)).rows[0];
    await runMigrations(t.db);
    expect((await t.db.execute(sql`SELECT count(*)::int AS n FROM appointments`)).rows[0]).toEqual(before);
  });
});
