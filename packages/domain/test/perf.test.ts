import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { loadDbEnv, runSeed } from '@clinic/db';
import { confirmBooking, getAvailability, holdSlot, type Ctx } from '../src/index.js';
import { createTestDb, makeCtx, must, rows, type Clock, type TestDb } from './helpers.js';

// Full-size seed: acceptance 17 asks for "search free time by service across all doctors of a city,
// 14 days" in under 300 ms.
let t: TestDb;
const NOW = new Date('2026-11-17T10:00:00Z');
const clock: Clock = { now: NOW };
let ctx: Ctx;

beforeAll(async () => {
  t = await createTestDb();
  await runSeed(
    t.pool,
    loadDbEnv({
      DATABASE_URL: t.url,
      SEED_PASSWORD: 'demo-password-1',
      SEED_NOW: NOW.toISOString(),
    }),
  );
  ctx = makeCtx(t.db, clock);
}, 300_000);
afterAll(async () => {
  await t.drop();
});

const p95 = async (runs: number, f: () => Promise<unknown>): Promise<number> => {
  await f();
  const ts: number[] = [];
  for (let i = 0; i < runs; i++) {
    const s = performance.now();
    await f();
    ts.push(performance.now() - s);
  }
  ts.sort((a, b) => a - b);
  return ts[Math.ceil(runs * 0.95) - 1] as number;
};

describe('availability on the full seed', () => {
  it('every clinic × every service, 14 days, all doctors: p95 < 300 ms and the grid is not empty', async () => {
    // combos where at least one doctor works in the clinic AND offers the service
    const combos = await rows<{ clinic: string; service: string; code: string }>(
      t.db,
      sql`
      SELECT DISTINCT cs.clinic_id AS clinic, cs.service_id AS service, s.code FROM clinic_services cs
      JOIN services s ON s.id = cs.service_id
      JOIN doctor_services ds ON ds.service_id = cs.service_id
      JOIN schedule_templates t ON t.doctor_id = ds.doctor_id AND t.clinic_id = cs.clinic_id`,
    );
    expect(combos.length).toBeGreaterThan(20);
    let nonEmpty = 0;
    const worst: number[] = [];
    for (const c of combos) {
      const run = () => getAvailability(ctx, { clinicId: c.clinic, serviceId: c.service });
      const r = must(await run());
      if (r.slots.length > 0) nonEmpty++;
      worst.push(await p95(8, run));
    }
    expect(nonEmpty).toBe(combos.length); // 14 days of a seeded clinic always have some free time
    console.log(
      'availability p95 per combo (ms): max',
      Math.max(...worst).toFixed(1),
      'median',
      worst.sort((a, b) => a - b)[Math.floor(worst.length / 2)]?.toFixed(1),
    );
    expect(Math.max(...worst)).toBeLessThan(300);
  });

  it('a hold and a confirm on the full seed are quick too', async () => {
    const patient = (
      await rows<{ id: string; user_id: string }>(
        t.db,
        sql`SELECT id, user_id FROM patients p WHERE user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = p.id AND a.status <> 'cancelled' AND a.starts_at > ${NOW.toISOString()}::timestamptz) AND online_booking_blocked_until IS NULL LIMIT 1`,
      )
    )[0];
    const clinic = (
      await rows<{ id: string }>(t.db, sql`SELECT id FROM clinics WHERE code = 'kyiv'`)
    )[0];
    const svc = (
      await rows<{ id: string }>(t.db, sql`SELECT id FROM services WHERE code = 'therapy-consult'`)
    )[0];
    const g = must(
      await getAvailability(ctx, { clinicId: clinic?.id as string, serviceId: svc?.id as string }),
    );
    const slot = g.slots[0];
    expect(slot).toBeDefined();
    const actor = {
      userId: patient?.user_id as string,
      role: 'patient' as const,
      patientId: patient?.id as string,
    };
    const s = performance.now();
    const h = must(
      await holdSlot(ctx, actor, {
        clinicId: clinic?.id as string,
        doctorId: slot?.doctorId as string,
        serviceId: svc?.id as string,
        startsAt: slot?.startsAt as Date,
      }),
    );
    const a = must(
      await confirmBooking(ctx, actor, { appointmentId: h.id, idempotencyKey: 'perf-key-1' }),
    );
    expect(performance.now() - s).toBeLessThan(500);
    expect(a.status).toBe('booked');
  });
});
