import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, createPool, runMigrations, schema, type Db } from '../src/index.js';

export type TestDb = { pool: pg.Pool; db: Db; url: string; drop: () => Promise<void> };

/** A fresh, fully migrated database inside the shared Postgres container. */
export const createTestDb = async (poolSize = 30): Promise<TestDb> => {
  const admin = new pg.Client({ connectionString: inject('pgAdminUrl') });
  await admin.connect();
  const name = `t_${randomUUID().replace(/-/g, '')}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const u = new URL(inject('pgAdminUrl'));
  u.pathname = `/${name}`;
  const url = u.toString();
  const pool = createPool(url, poolSize);
  const db = createDb(pool);
  await runMigrations(db);
  return {
    pool,
    db,
    url,
    drop: async () => {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
};

export const T = (iso: string): Date => new Date(iso);
export const MIN = 60_000;

export type World = {
  kyiv: string;
  warsaw: string;
  uziRoomKyiv: string;
  /** services */
  consult30: string; // 30 min, no UZI
  quick15: string; // 15 min, no UZI
  uzi30: string; // 30 min, UZI
  uzi45: string; // 45 min, UZI
  doctors: string[]; // 6 doctors, all provide every service, work in Kyiv
  warsawDoctor: string;
  patients: string[]; // 40
};

export const makeWorld = async (db: Db): Promise<World> => {
  const [kyiv, warsaw] = await db
    .insert(schema.clinics)
    .values([
      { code: 'kyiv', city: 'Київ', timeZone: 'Europe/Kyiv', currency: 'UAH' },
      { code: 'warsaw', city: 'Варшава', timeZone: 'Europe/Warsaw', currency: 'PLN' },
    ])
    .returning();
  if (!kyiv || !warsaw) throw new Error('clinic insert failed');
  const rooms = await db
    .insert(schema.rooms)
    .values([
      { clinicId: kyiv.id, name: 'UZI K' },
      { clinicId: warsaw.id, name: 'UZI W' },
    ])
    .returning();
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
      {
        code: 'u45',
        specialty: 'x',
        nameUk: 'u45',
        nameEn: 'u45',
        namePl: 'u45',
        durationMin: 45,
        needsUltrasound: true,
      },
    ])
    .returning();
  const [c30, q15, u30, u45] = svc;
  if (!c30 || !q15 || !u30 || !u45) throw new Error('service insert failed');
  for (const clinic of [kyiv, warsaw])
    await db
      .insert(schema.clinicServices)
      .values(svc.map((s) => ({ clinicId: clinic.id, serviceId: s.id, priceMinor: 100_000 })));
  const docs = await db
    .insert(schema.doctors)
    .values(Array.from({ length: 7 }, (_, i) => ({ fullName: `Doctor ${i}`, specialty: 'x' })))
    .returning();
  for (const d of docs)
    await db
      .insert(schema.doctorServices)
      .values(svc.map((s) => ({ doctorId: d.id, serviceId: s.id })));
  const pats = await db
    .insert(schema.patients)
    .values(
      Array.from({ length: 40 }, (_, i) => ({
        fullName: `Patient ${i}`,
        phone: `+3805000000${String(i).padStart(2, '0')}`,
      })),
    )
    .returning();
  const uziK = rooms.find((r) => r.clinicId === kyiv.id);
  if (!uziK) throw new Error('room missing');
  return {
    kyiv: kyiv.id,
    warsaw: warsaw.id,
    uziRoomKyiv: uziK.id,
    consult30: c30.id,
    quick15: q15.id,
    uzi30: u30.id,
    uzi45: u45.id,
    doctors: docs.slice(0, 6).map((d) => d.id),
    warsawDoctor: (docs[6] as { id: string }).id,
    patients: pats.map((p) => p.id),
  };
};

export type ApptInput = {
  patientId: string;
  doctorId: string;
  clinicId: string;
  serviceId: string;
  startsAt: Date;
  minutes: number;
  status?: 'held' | 'booked' | 'cancelled' | 'checked_in' | 'completed' | 'no_show';
  kind?: 'regular' | 'waitlist_offer';
  holdExpiresAt?: Date | null;
  roomId?: string | null;
  prepMinutes?: number;
};

export const apptValues = (a: ApptInput) => ({
  patientId: a.patientId,
  doctorId: a.doctorId,
  clinicId: a.clinicId,
  serviceId: a.serviceId,
  startsAt: a.startsAt,
  endsAt: new Date(a.startsAt.getTime() + a.minutes * MIN),
  // derived by trigger; placeholders keep the NOT NULL columns happy
  occupiedUntil: new Date(a.startsAt.getTime() + (a.minutes + 5) * MIN),
  localDate: '2000-01-01',
  status: a.status ?? 'booked',
  kind: a.kind ?? 'regular',
  holdExpiresAt:
    a.holdExpiresAt === undefined
      ? a.status === 'held'
        ? new Date(a.startsAt.getTime())
        : null
      : a.holdExpiresAt,
  roomId: a.roomId ?? null,
  priceMinor: 100_000,
  currency: 'UAH' as const,
  prepMinutes: a.prepMinutes ?? 5,
});

export const insertAppt = async (db: Db, a: ApptInput): Promise<string> => {
  const [row] = await db
    .insert(schema.appointments)
    .values(apptValues(a))
    .returning({ id: schema.appointments.id });
  if (!row) throw new Error('insert failed');
  return row.id;
};

export const rawStatus = async (db: Db, id: string): Promise<string> => {
  const r = await db.execute(sql`SELECT status FROM appointments WHERE id = ${id}::uuid`);
  return String((r.rows[0] as { status: string }).status);
};
