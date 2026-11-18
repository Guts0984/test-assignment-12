import { loadApiEnv } from './env.js';
import { createApi } from './app.js';

const main = async (): Promise<void> => {
  const env = loadApiEnv();
  const api = await createApi(env);
  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      svc: 'api',
      msg: 'listening',
      port: api.port,
      env: env.NODE_ENV,
    }),
  );
  const stop = (): void => {
    void api.close().finally(() => process.exit(0));
    setTimeout(() => process.exit(1), 15_000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
};

main().catch((e: unknown) => {
  console.error('api failed to start:', e);
  process.exit(1);
});
