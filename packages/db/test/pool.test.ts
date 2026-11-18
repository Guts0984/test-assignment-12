import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { sql } from 'drizzle-orm';
import { createDb, createPool } from '../src/index.js';
import { createTestDb, type TestDb } from './helpers.js';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.drop();
});

describe('connection pool survives the database killing connections', () => {
  it('terminating idle connections does not crash the process and the pool recovers', async () => {
    const errors: string[] = [];
    const pool = createPool(t.url, 5, (e) => errors.push(e.message));
    const db = createDb(pool);
    await Promise.all(Array.from({ length: 5 }, () => db.execute(sql`SELECT pg_sleep(0.05)`)));
    const admin = new pg.Client({ connectionString: t.url });
    await admin.connect();
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND application_name = ''",
    );
    await new Promise((r) => setTimeout(r, 300));
    const r = await db.execute(sql`SELECT 1 AS ok`);
    expect((r.rows[0] as { ok: number }).ok).toBe(1);
    expect(errors.length).toBeGreaterThan(0);
    await admin.end();
    await pool.end();
  });
});
