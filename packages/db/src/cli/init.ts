import { createDb, createPool } from '../client.js';
import { loadDbEnv } from '../env.js';
import { runMigrations } from '../migrate.js';
import { runSeed } from '../seed/index.js';

const main = async (): Promise<void> => {
  const env = loadDbEnv();
  const pool = createPool(env.DATABASE_URL, 2);
  try {
    const db = createDb(pool);
    console.log('[db-init] running migrations');
    await runMigrations(db);
    if (env.SEED_ENABLED) {
      console.log('[db-init] seeding (skipped when already seeded)');
      await runSeed(pool, env);
    }
    console.log('[db-init] done');
  } finally {
    await pool.end();
  }
};

main().catch((e: unknown) => {
  console.error('[db-init] failed', e);
  process.exit(1);
});
