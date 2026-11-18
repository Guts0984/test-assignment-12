import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, createPool, runMigrations, schema, type Db } from '@clinic/db';
import {
  DEFAULT_RULES,
  addDays,
  isoWeekday,
  localToInstant,
  type AppError,
  type Result,
  type Rules,
} from '@clinic/shared';
import type { Actor, Ctx } from '../src/index.js';

declare module 'vitest' {
  export interface ProvidedContext {
    pgAdminUrl: string;
  }
}

export type TestDb = { pool: pg.Pool; db: Db; url: string; drop: () => Promise<void> };

export const createTestDb = async (poolSize = 40): Promise<TestDb> => {
  const admin = new pg.Client({ connectionString: inject('pgAdminUrl') });
  await admin.connect();
  const name = `t_${randomUUID().replace(/-/g, '')}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const u = new URL(inject('pgAdminUrl'));
  u.pathname = `/${name}`;
  const pool = createPool(u.toString(), poolSize, () => undefined);
  const db = createDb(pool);
  await runMigrations(db);
  return {
    pool,
    db,
    url: u.toString(),
    drop: async () => {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
};

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
/** Monday 2026-06-01 08:00 UTC. */
export const T0 = new Date('2026-06-01T08:00:00Z');

export type Clock = { now: Date };
export const makeCtx = (db: Db, clock: Clock, rules: Partial<Rules> = {}): Ctx => ({
  db,
  now: () => clock.now,
  rules: { ...DEFAULT_RULES, ...rules },
});

export const must = <T>(r: Result<T, AppError>, label = ''): T => {
  if (!r.ok) throw new Error(`${label} expected ok, got ${r.error.code}: ${r.error.message}`);
  return r.value;
};
export const codeOf = (r: Result<unknown, AppError>): string => (r.ok ? 'ok' : r.error.code);

/** The k-th working day (Mon–Fri) on or after 2026-06-10, as a clinic-local date. */
export const workday = (k: number): string => {
  let d = '2026-06-10';
  let n = k;
  while (true) {
    if (isoWeekday(d) <= 5) {
      if (n === 0) return d;
      n--;
    }
    d = addDays(d, 1);
  }
};
export const at = (date: string, time: string, tz = 'Europe/Kyiv'): Date => {
  const r = localToInstant(date, time, tz);
  if (!r.ok) throw new Error(`nonexistent ${date} ${time}`);
  return r.value;
};

export type World = {
  kyiv: string;
  warsaw: string;
  c30: string;
  q15: string;
  u30: string;
  kyivDoctors: string[];
  warsawDoctor: string;
  patients: { id: string; userId: string; actor: Actor }[];
  registrar: { kyiv: Actor; warsaw: Actor };
  doctorActor: (i: number) => Actor;
  doctorUsers: string[];
};

export const makeWorld = async (db: Db): Promise<World> => {
  const [kyiv, warsaw] = await db
    .insert(schema.clinics)
    .values([
      { code: 'kyiv', city: 'Київ', timeZone: 'Europe/Kyiv', currency: 'UAH' },
      { code: 'warsaw', city: 'Варшава', timeZone: 'Europe/Warsaw', currency: 'PLN' },
    ])
    .returning();
  if (!kyiv || !warsaw) throw new Error('clinics');
  await db.insert(schema.rooms).values([
    { clinicId: kyiv.id, name: 'UZI K' },
    { clinicId: warsaw.id, name: 'UZI W' },
  ]);
  const svc = await db
    .insert(schema.services)
    .values([
      { code: 'c30', specialty: 'x', nameUk: 'c30', nameEn: 'c30', namePl: 'c30', durationMin: 30 },
      { code: 'q15', specialty: 'x', nameUk: 'q15', nameEn: 'q15', namePl: 'q15', durationMin: 15 },
      {
        code: 'u30',
        specialty: 'x',
        nameUk: 'u30',
        nameEn: 'u30',
        namePl: 'u30',
        durationMin: 30,
        needsUltrasound: true,
      },
    ])
    .returning();
  const [c30, q15, u30] = svc;
  if (!c30 || !q15 || !u30) throw new Error('services');
  await db.insert(schema.clinicServices).values(
    svc.flatMap((s) => [
      { clinicId: kyiv.id, serviceId: s.id, priceMinor: 70_000 },
      { clinicId: warsaw.id, serviceId: s.id, priceMinor: 25_000 },
    ]),
  );
  const docs = await db
    .insert(schema.doctors)
    .values(Array.from({ length: 7 }, (_, i) => ({ fullName: `Doctor ${i}`, specialty: 'x' })))
    .returning();
  for (const d of docs)
    await db
      .insert(schema.doctorServices)
      .values(svc.map((s) => ({ doctorId: d.id, serviceId: s.id })));
  const kyivDoctors = docs.slice(0, 6).map((d) => d.id);
  const warsawDoctor = (docs[6] as { id: string }).id;
  for (const wd of [1, 2, 3, 4, 5]) {
    await db.insert(schema.scheduleTemplates).values([
      ...kyivDoctors.map((doctorId) => ({
        doctorId,
        clinicId: kyiv.id,
        weekday: wd,
        startLocal: '09:00',
        endLocal: '17:00',
        breakStartLocal: '13:00',
        breakEndLocal: '14:00',
      })),
      {
        doctorId: warsawDoctor,
        clinicId: warsaw.id,
        weekday: wd,
        startLocal: '09:00',
        endLocal: '17:00',
      },
    ]);
  }
  const mkUser = async (
    email: string,
    role: 'patient' | 'registrar' | 'doctor',
    extra: { clinicId?: string; doctorId?: string } = {},
  ): Promise<string> => {
    const [u] = await db
      .insert(schema.users)
      .values({ email, passwordHash: 'x', role, ...extra })
      .returning({ id: schema.users.id });
    return (u as { id: string }).id;
  };
  const patients: World['patients'] = [];
  for (let i = 0; i < 40; i++) {
    const userId = await mkUser(`p${i}@t.io`, 'patient');
    const [p] = await db
      .insert(schema.patients)
      .values({
        userId,
        fullName: `Patient ${i}`,
        phone: `+3805000000${String(i).padStart(2, '0')}`,
        email: `p${i}@t.io`,
        locale: 'uk',
      })
      .returning({ id: schema.patients.id });
    const id = (p as { id: string }).id;
    patients.push({ id, userId, actor: { userId, role: 'patient', patientId: id } });
  }
  const regK = await mkUser('rk@t.io', 'registrar', { clinicId: kyiv.id });
  const regW = await mkUser('rw@t.io', 'registrar', { clinicId: warsaw.id });
  const doctorUsers: string[] = [];
  for (const [i, d] of docs.entries())
    doctorUsers.push(await mkUser(`d${i}@t.io`, 'doctor', { doctorId: d.id }));
  return {
    kyiv: kyiv.id,
    warsaw: warsaw.id,
    c30: c30.id,
    q15: q15.id,
    u30: u30.id,
    kyivDoctors,
    warsawDoctor,
    patients,
    registrar: {
      kyiv: { userId: regK, role: 'registrar', clinicId: kyiv.id },
      warsaw: { userId: regW, role: 'registrar', clinicId: warsaw.id },
    },
    doctorUsers,
    doctorActor: (i) => ({
      userId: doctorUsers[i] as string,
      role: 'doctor',
      doctorId: (docs[i] as { id: string }).id,
    }),
  };
};

export const rows = async <T = Record<string, unknown>>(
  db: Db,
  q: ReturnType<typeof sql>,
): Promise<T[]> => (await db.execute(q)).rows as T[];
export const count = async (db: Db, q: ReturnType<typeof sql>): Promise<number> =>
  Number(((await rows<{ n: number }>(db, q))[0] as { n: number }).n);
