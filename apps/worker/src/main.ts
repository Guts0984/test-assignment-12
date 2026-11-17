import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadWorkerEnv } from './env.js';
import { WorkerModule } from './worker.js';

const main = async (): Promise<void> => {
  const env = loadWorkerEnv();
  const app = await NestFactory.createApplicationContext(WorkerModule.register(env), { logger: ['error', 'warn'] });
  app.enableShutdownHooks();
  console.log(JSON.stringify({ at: new Date().toISOString(), svc: 'worker', msg: 'started', concurrency: env.WORKER_CONCURRENCY }));
};

main().catch((e: unknown) => {
  console.error('worker failed to start:', e);
  process.exit(1);
});
