import { createPool } from '../client.js';
import { loadDbEnv } from '../env.js';
import { runSeed } from '../seed/index.js';

const main = async (): Promise<void> => {
  const env = loadDbEnv();
  const pool = createPool(env.DATABASE_URL, 2);
  try {
    await runSeed(pool, env);
  } finally {
    await pool.end();
  }
};

main().catch((e: unknown) => {
  console.error('[seed] failed', e);
  process.exit(1);
});
