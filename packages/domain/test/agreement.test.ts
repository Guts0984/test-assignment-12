import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { sql } from 'drizzle-orm';
import { schema, asPgError } from '@clinic/db';
import { getAvailability, type Ctx } from '../src/index.js';
import {
  MIN,
  T0,
  at,
  createTestDb,
  makeCtx,
  makeWorld,
  workday,
  type Clock,
  type TestDb,
  type World,
} from './helpers.js';

// The grid and the database answer the same question in two ways: "can a visit start here?".
// They must agree on every 15-minute start of a working day, for any pile of existing visits.
let t: TestDb;
let w: World;
const clock: Clock = { now: T0 };
let ctx: Ctx;

beforeAll(async () => {
  t = await createTestDb();
  w = await makeWorld(t.db);
  ctx = makeCtx(t.db, clock);
});
afterAll(async () => {
  await t.drop();
});

const ROLLBACK = Symbol('rollback');

const dbAccepts = async (
  doctorId: string,
  serviceId: string,
  startsAt: Date,
  minutes: number,
  patientId: string,
): Promise<boolean> => {
  try {
    await t.db.transaction(async (tx) => {
      await tx.insert(schema.appointments).values({
        patientId,
        doctorId,
        clinicId: w.kyiv,
        serviceId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + minutes * MIN),
        occupiedUntil: startsAt,
        localDate: '2000-01-01',
        status: 'booked',
        priceMinor: 1,
        currency: 'UAH',
      });
      throw ROLLBACK;
    });
    return true;
  } catch (e) {
    if (e === ROLLBACK) return true;
    const pg = asPgError(e);
    if (pg?.code === '23P01') return false;
    throw e;
  }
};

describe('grid ⟺ database exclusion constraints', () => {
  it('for random existing visits, a start is in the grid exactly when the database would accept it', async () => {
    let round = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            q: fc.integer({ min: 0, max: 31 }),
            doctor: fc.integer({ min: 0, max: 2 }),
            svc: fc.constantFrom('c30', 'q15', 'u30'),
          }),
          { maxLength: 14 },
        ),
        fc.constantFrom('c30', 'q15', 'u30'),
        async (existing, probe) => {
          round++;
          await t.db.execute(sql`TRUNCATE appointments CASCADE`);
          const d = workday(1 + (round % 5));
          const svcId = (s: string) => (s === 'c30' ? w.c30 : s === 'q15' ? w.q15 : w.u30);
          const mins = (s: string) => (s === 'c30' || s === 'u30' ? 30 : 15);
          let p = 0;
          for (const e of existing) {
            const start = at(
              d,
              `${String(9 + Math.floor(e.q / 4)).padStart(2, '0')}:${String((e.q % 4) * 15).padStart(2, '0')}`,
            );
            await dbAccepts(
              w.kyivDoctors[e.doctor] as string,
              svcId(e.svc),
              start,
              mins(e.svc),
              (w.patients[p++ % 40] as World['patients'][number]).id,
            ).then(async (ok) => {
              if (!ok) return;
              await t.db
                .insert(schema.appointments)
                .values({
                  patientId: (w.patients[(p + 20) % 40] as World['patients'][number]).id,
                  doctorId: w.kyivDoctors[e.doctor] as string,
                  clinicId: w.kyiv,
                  serviceId: svcId(e.svc),
                  startsAt: start,
                  endsAt: new Date(start.getTime() + mins(e.svc) * MIN),
                  occupiedUntil: start,
                  localDate: '2000-01-01',
                  status: 'booked',
                  priceMinor: 1,
                  currency: 'UAH',
                })
                .catch(() => undefined);
            });
          }
          for (const doctor of [0, 1]) {
            const g = await getAvailability(ctx, {
              clinicId: w.kyiv,
              serviceId: svcId(probe),
              doctorId: w.kyivDoctors[doctor] as string,
              fromDate: d,
              days: 1,
            });
            if (!g.ok) throw new Error('availability failed');
            const free = new Set(g.value.slots.map((s) => s.startsAt.getTime()));
            for (let m = 9 * 60; m < 17 * 60; m += 15) {
              const start = at(
                d,
                `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
              );
              const inHours =
                !(m >= 13 * 60 && m < 14 * 60) &&
                m + mins(probe) <= 17 * 60 &&
                !(m < 13 * 60 && m + mins(probe) > 13 * 60);
              if (!inHours) {
                expect(
                  free.has(start.getTime()),
                  `${d} ${m} outside hours must not be offered`,
                ).toBe(false);
                continue;
              }
              const db = await dbAccepts(
                w.kyivDoctors[doctor] as string,
                svcId(probe),
                start,
                mins(probe),
                (w.patients[39] as World['patients'][number]).id,
              );
              expect(
                free.has(start.getTime()),
                `${d} ${m / 60} doctor ${doctor} ${probe}: grid says ${free.has(start.getTime())}, database says ${db}`,
              ).toBe(db);
            }
          }
        },
      ),
      { numRuns: 40 },
    );
  }, 180_000);
});
