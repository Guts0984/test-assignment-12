import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { APPOINTMENT_STATUSES } from '@clinic/shared';
import { PG, asPgError, withActorTx } from '../src/index.js';
import { MIN, T, createTestDb, insertAppt, makeWorld, type TestDb, type World } from './helpers.js';

let t: TestDb;
let w: World;
const NOON = T('2026-09-02T09:00:00Z');
let counter = 0;
const slot = (): Date => new Date(NOON.getTime() + 24 * 3600_000 * ++counter);

beforeAll(async () => {
  t = await createTestDb();
  w = await makeWorld(t.db);
});
afterAll(async () => {
  await t.drop();
});

const LEGAL = new Set(['held>booked', 'held>cancelled', 'booked>cancelled', 'booked>checked_in', 'booked>no_show', 'checked_in>completed']);

const make = async (status: (typeof APPOINTMENT_STATUSES)[number]): Promise<string> => {
  // build the row through the legal path so the trigger is honoured
  const id = await insertAppt(t.db, {
    patientId: w.patients[counter % 40] as string,
    doctorId: w.doctors[counter % 6] as string,
    clinicId: w.kyiv,
    serviceId: w.consult30,
    startsAt: slot(),
    minutes: 30,
    status: 'held',
    holdExpiresAt: T('2030-01-01T00:00:00Z'),
  });
  const path: Record<string, string[]> = {
    held: [],
    booked: ['booked'],
    checked_in: ['booked', 'checked_in'],
    completed: ['booked', 'checked_in', 'completed'],
    no_show: ['booked', 'no_show'],
    cancelled: ['cancelled'],
  };
  for (const s of path[status] ?? []) await t.db.execute(sql`UPDATE appointments SET status = ${s}::appointment_status WHERE id = ${id}::uuid`);
  return id;
};

describe('status machine is enforced by the database', () => {
  for (const from of APPOINTMENT_STATUSES) {
    for (const to of APPOINTMENT_STATUSES) {
      if (from === to) continue;
      const legal = LEGAL.has(`${from}>${to}`);
      it(`${from} → ${to} is ${legal ? 'allowed' : 'rejected'}`, async () => {
        const id = await make(from);
        const err = await t.db
          .execute(sql`UPDATE appointments SET status = ${to}::appointment_status WHERE id = ${id}::uuid`)
          .then(() => null, asPgError);
        if (legal) expect(err).toBeNull();
        else expect(err?.code).toBe(PG.INVALID_TRANSITION);
      });
    }
  }

  it('finished and cancelled visits cannot be moved in time', async () => {
    for (const s of ['completed', 'no_show', 'cancelled', 'checked_in'] as const) {
      const id = await make(s);
      const err = await t.db
        .execute(sql`UPDATE appointments SET starts_at = starts_at + interval '1 day', ends_at = ends_at + interval '1 day' WHERE id = ${id}::uuid`)
        .then(() => null, asPgError);
      expect(err?.code, s).toBe(PG.INVALID_TRANSITION);
    }
  });

  it('a reschedule is one UPDATE that bumps the version and recomputes derived columns', async () => {
    const id = await make('booked');
    const before = await t.db.execute(sql`SELECT version, local_date::text AS d FROM appointments WHERE id = ${id}::uuid`);
    await t.db.execute(sql`UPDATE appointments SET starts_at = starts_at + interval '3 days', ends_at = ends_at + interval '3 days' WHERE id = ${id}::uuid`);
    const after = await t.db.execute(sql`SELECT version, local_date::text AS d FROM appointments WHERE id = ${id}::uuid`);
    const b = before.rows[0] as { version: number; d: string };
    const a = after.rows[0] as { version: number; d: string };
    expect(a.version).toBe(b.version + 1);
    expect(a.d).not.toBe(b.d);
  });

  it('a reschedule into a slot someone else holds fails and leaves the old row intact (invariant 5)', async () => {
    const doc = w.doctors[0] as string;
    const mineAt = slot();
    const target = slot();
    const mine = await insertAppt(t.db, { patientId: w.patients[28] as string, doctorId: doc, clinicId: w.kyiv, serviceId: w.consult30, startsAt: mineAt, minutes: 30 });
    await insertAppt(t.db, { patientId: w.patients[30] as string, doctorId: doc, clinicId: w.kyiv, serviceId: w.consult30, startsAt: target, minutes: 30 });
    const err = await t.db
      .execute(sql`UPDATE appointments SET starts_at = ${target.toISOString()}::timestamptz, ends_at = ${new Date(target.getTime() + 30 * MIN).toISOString()}::timestamptz WHERE id = ${mine}::uuid`)
      .then(() => null, asPgError);
    expect(err?.code).toBe(PG.EXCLUSION_VIOLATION);
    const after = (await t.db.execute(sql`SELECT starts_at, status, version FROM appointments WHERE id = ${mine}::uuid`)).rows[0] as { starts_at: string; status: string; version: number };
    expect(new Date(after.starts_at).getTime()).toBe(mineAt.getTime());
    expect(after.status).toBe('booked');
    expect(after.version).toBe(1);
  });
});

describe('history is written by the database and cannot be skipped or edited', () => {
  it('records actor, role, clock and reason through transaction settings', async () => {
    const id = await insertAppt(t.db, { patientId: w.patients[1] as string, doctorId: w.doctors[0] as string, clinicId: w.kyiv, serviceId: w.consult30, startsAt: slot(), minutes: 30, status: 'held', holdExpiresAt: T('2030-01-01T00:00:00Z') });
    const user = (await t.db.execute(sql`INSERT INTO users (email, password_hash, role, clinic_id) VALUES ('reg@x.io','x','registrar', ${w.kyiv}::uuid) RETURNING id`)).rows[0] as { id: string };
    const when = T('2026-01-05T10:00:00Z');
    await withActorTx(t.db, { actor: { userId: user.id, role: 'registrar' }, now: when, reason: 'phone call', late: true }, async (tx) => {
      await tx.execute(sql`UPDATE appointments SET status = 'booked' WHERE id = ${id}::uuid`);
      await tx.execute(sql`UPDATE appointments SET status = 'cancelled' WHERE id = ${id}::uuid`);
    });
    const ev = (await t.db.execute(sql`SELECT type, from_status, to_status, actor_role, actor_user_id, late, reason, at FROM appointment_events WHERE appointment_id = ${id}::uuid ORDER BY at, type`)).rows as Record<string, unknown>[];
    expect(ev.map((e) => e['type']).sort()).toEqual(['cancelled', 'confirmed', 'held']);
    const cancelled = ev.find((e) => e['type'] === 'cancelled') as Record<string, unknown>;
    expect(cancelled['actor_role']).toBe('registrar');
    expect(cancelled['actor_user_id']).toBe(user.id);
    expect(cancelled['late']).toBe(true);
    expect(cancelled['reason']).toBe('phone call');
    expect(new Date(String(cancelled['at'])).getTime()).toBe(when.getTime());
  });

  it('a raw SQL change with no context still leaves a trace, attributed to "system"', async () => {
    const id = await make('booked');
    await t.db.execute(sql`UPDATE appointments SET status = 'no_show' WHERE id = ${id}::uuid`);
    const ev = (await t.db.execute(sql`SELECT actor_role, type FROM appointment_events WHERE appointment_id = ${id}::uuid AND type = 'no_show'`)).rows as { actor_role: string }[];
    expect(ev).toHaveLength(1);
    expect(ev[0]?.actor_role).toBe('system');
  });

  it('a reschedule is recorded with old and new time', async () => {
    const id = await make('booked');
    await t.db.execute(sql`UPDATE appointments SET starts_at = starts_at + interval '1 day', ends_at = ends_at + interval '1 day' WHERE id = ${id}::uuid`);
    const ev = (await t.db.execute(sql`SELECT old_starts_at, new_starts_at FROM appointment_events WHERE appointment_id = ${id}::uuid AND type = 'rescheduled'`)).rows as { old_starts_at: string; new_starts_at: string }[];
    expect(ev).toHaveLength(1);
    expect(new Date(ev[0]?.new_starts_at as string).getTime() - new Date(ev[0]?.old_starts_at as string).getTime()).toBe(24 * 3600_000);
  });

  it('a failed transaction leaves no history', async () => {
    const id = await make('booked');
    const n0 = (await t.db.execute(sql`SELECT count(*)::int AS n FROM appointment_events WHERE appointment_id = ${id}::uuid`)).rows[0] as { n: number };
    await t.db.transaction(async (tx) => {
      await tx.execute(sql`UPDATE appointments SET status = 'checked_in' WHERE id = ${id}::uuid`);
      throw new Error('boom');
    }).catch(() => undefined);
    const n1 = (await t.db.execute(sql`SELECT count(*)::int AS n FROM appointment_events WHERE appointment_id = ${id}::uuid`)).rows[0] as { n: number };
    expect(n1.n).toBe(n0.n);
  });

  it('history rows cannot be edited or deleted, even by raw SQL', async () => {
    const id = await make('booked');
    const upd = await t.db.execute(sql`UPDATE appointment_events SET type = 'forged' WHERE appointment_id = ${id}::uuid`).then(() => null, asPgError);
    const del = await t.db.execute(sql`DELETE FROM appointment_events WHERE appointment_id = ${id}::uuid`).then(() => null, asPgError);
    expect(upd?.code).toBe(PG.HISTORY_IMMUTABLE);
    expect(del?.code).toBe(PG.HISTORY_IMMUTABLE);
  });

  it('actor context does not leak to the next transaction on the same connection', async () => {
    const pool = new pg.Pool({ connectionString: t.url, max: 1 });
    const c = await pool.connect();
    const pid1 = (await c.query('SELECT pg_backend_pid() AS p')).rows[0].p;
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.actor_role','manager',true), set_config('app.actor_user_id','00000000-0000-0000-0000-000000000001',true)");
    await c.query('COMMIT');
    const r = await c.query("SELECT current_setting('app.actor_role', true) AS role, current_setting('app.actor_user_id', true) AS uid, pg_backend_pid() AS p");
    expect(r.rows[0].p).toBe(pid1);
    expect(r.rows[0].role || '').toBe('');
    expect(r.rows[0].uid || '').toBe('');
    // and a history row written afterwards on that connection is attributed to system
    const id = await insertAppt(t.db, { patientId: w.patients[2] as string, doctorId: w.doctors[1] as string, clinicId: w.kyiv, serviceId: w.consult30, startsAt: slot(), minutes: 30 });
    await c.query("UPDATE appointments SET status = 'cancelled' WHERE id = $1", [id]);
    const ev = await c.query("SELECT actor_role, actor_user_id FROM appointment_events WHERE appointment_id = $1 AND type = 'cancelled'", [id]);
    expect(ev.rows[0]).toEqual({ actor_role: 'system', actor_user_id: null });
    c.release();
    await pool.end();
  });
});

describe('release_expired_holds', () => {
  const callSweep = (now: Date, doctor: string | null, room: string | null, patient: string | null, from: Date, to: Date) =>
    t.db.execute(sql`SELECT release_expired_holds(${now.toISOString()}::timestamptz, ${doctor}::uuid, ${room}::uuid, ${patient}::uuid, ${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz) AS n`);

  it('releases only expired regular holds that touch the doctor/room/patient and the window', async () => {
    const start = slot();
    const doc = w.doctors[0] as string;
    const hold = (patient: number, doctor: string, startsAt: Date, expires: string, kind: 'regular' | 'waitlist_offer' = 'regular') =>
      insertAppt(t.db, { patientId: w.patients[patient] as string, doctorId: doctor, clinicId: w.kyiv, serviceId: w.consult30, startsAt, minutes: 30, status: 'held', kind, holdExpiresAt: T(expires) });
    const expired = await hold(1, doc, start, '2026-09-01T00:00:00Z');
    const fresh = await hold(2, w.doctors[1] as string, start, '2030-01-01T00:00:00Z');
    const offer = await hold(3, w.doctors[2] as string, start, '2026-09-01T00:00:00Z', 'waitlist_offer');
    const otherDoctor = await hold(4, w.doctors[3] as string, start, '2026-09-01T00:00:00Z');
    const farAway = await hold(1, doc, new Date(start.getTime() + 10 * 24 * 3600_000), '2026-09-01T00:00:00Z');
    const r = await callSweep(T('2026-09-05T00:00:00Z'), doc, null, null, start, new Date(start.getTime() + 60 * MIN));
    expect(Number((r.rows[0] as { n: number }).n)).toBe(1);
    const st = async (id: string) => String(((await t.db.execute(sql`SELECT status FROM appointments WHERE id = ${id}::uuid`)).rows[0] as { status: string }).status);
    expect(await st(expired)).toBe('cancelled');
    expect(await st(fresh)).toBe('held');
    expect(await st(offer)).toBe('held'); // offers are handed over by the worker, never released lazily
    expect(await st(otherDoctor)).toBe('held');
    expect(await st(farAway)).toBe('held');
    const ev = (await t.db.execute(sql`SELECT actor_role, reason FROM appointment_events WHERE appointment_id = ${expired}::uuid AND type = 'cancelled'`)).rows as { actor_role: string; reason: string }[];
    expect(ev[0]).toEqual({ actor_role: 'system', reason: 'hold_expired' });
  });

  it('a hold expiring exactly now is expired (boundary), one second earlier is still alive', async () => {
    const s = slot();
    const doc = w.doctors[4] as string;
    await insertAppt(t.db, { patientId: w.patients[5] as string, doctorId: doc, clinicId: w.kyiv, serviceId: w.consult30, startsAt: s, minutes: 30, status: 'held', holdExpiresAt: T('2026-09-05T00:00:00Z') });
    const r1 = await callSweep(T('2026-09-04T23:59:59Z'), doc, null, null, s, new Date(s.getTime() + 30 * MIN));
    expect(Number((r1.rows[0] as { n: number }).n)).toBe(0);
    const r2 = await callSweep(T('2026-09-05T00:00:00Z'), doc, null, null, s, new Date(s.getTime() + 30 * MIN));
    expect(Number((r2.rows[0] as { n: number }).n)).toBe(1);
  });

  it('after the sweep the slot can be taken; 10 racing sweep+insert transactions yield exactly one booking (losers: exclusion violation or a deadlock abort, never anything else)', async () => {
    const s = slot();
    const doc = w.doctors[5] as string;
    await insertAppt(t.db, { patientId: w.patients[6] as string, doctorId: doc, clinicId: w.kyiv, serviceId: w.consult30, startsAt: s, minutes: 30, status: 'held', holdExpiresAt: T('2026-09-01T00:00:00Z') });
    const now = T('2026-09-05T00:00:00Z');
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        t.db
          .transaction(async (tx) => {
            await callSweepTx(tx, now, doc, s);
            await insertAppt(tx as unknown as typeof t.db, { patientId: w.patients[10 + i] as string, doctorId: doc, clinicId: w.kyiv, serviceId: w.consult30, startsAt: s, minutes: 30, status: 'booked' });
            return 'ok';
          })
          .catch((e: unknown) => asPgError(e)?.code ?? 'unknown'),
      ),
    );
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    // a loser is either rejected by the exclusion constraint or aborted by Postgres' deadlock detector
    // (the engine retries the latter); both mean "not booked". What must never happen: two winners.
    for (const r of results.filter((x) => x !== 'ok')) expect([PG.EXCLUSION_VIOLATION, PG.DEADLOCK]).toContain(r);
  });
});

const callSweepTx = (tx: { execute: typeof t.db.execute }, now: Date, doc: string, s: Date) =>
  tx.execute(sql`SELECT release_expired_holds(${now.toISOString()}::timestamptz, ${doc}::uuid, NULL, NULL, ${s.toISOString()}::timestamptz, ${new Date(s.getTime() + 30 * MIN).toISOString()}::timestamptz)`);

describe('task ledger', () => {
  it('dedupe_key is unique: a repeated insert cannot create a second task', async () => {
    const ins = () => t.db.execute(sql`INSERT INTO scheduled_tasks (kind, run_at, dedupe_key) VALUES ('reminder.24h', now(), 'reminder:24h:abc:v1')`).then(() => null, asPgError);
    expect(await ins()).toBeNull();
    expect((await ins())?.code).toBe(PG.UNIQUE_VIOLATION);
  });

  it('inserting a task wakes up LISTENers; a rolled-back insert does not', async () => {
    const listener = new pg.Client({ connectionString: t.url });
    await listener.connect();
    await listener.query('LISTEN scheduled_tasks');
    const got: string[] = [];
    listener.on('notification', (m) => got.push(m.payload ?? ''));
    await t.db.transaction(async (tx) => {
      await tx.execute(sql`INSERT INTO scheduled_tasks (kind, run_at, dedupe_key) VALUES ('x', now(), 'rolled-back')`);
      throw new Error('rollback');
    }).catch(() => undefined);
    await t.db.execute(sql`INSERT INTO scheduled_tasks (kind, run_at, dedupe_key) VALUES ('x', now(), 'committed')`);
    await new Promise((r) => setTimeout(r, 300));
    expect(got).toHaveLength(1);
    await listener.end();
  });
});
