import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { GraphQLSchemaHost } from '@nestjs/graphql';
import { Redis } from 'ioredis';
import type { NextFunction, Request, Response } from 'express';
import { createDb, createPool } from '@clinic/db';
import { rulesFromEnv } from '@clinic/shared';
import type { ApiEnv } from './env.js';
import { ApiModule, type SchemaRef } from './module.js';
import { clientIp, parseCidrs } from './infra/ip.js';
import { createLimiter } from './infra/rate-limit.js';
import { createEventBus } from './infra/event-bus.js';
import type { Services } from './infra/tokens.js';

const log = (msg: string, extra?: Record<string, unknown>): void => {
  console.log(JSON.stringify({ at: new Date().toISOString(), svc: 'api', msg, ...extra }));
};

export type RunningApi = {
  app: NestExpressApplication;
  url: string;
  port: number;
  services: Services;
  schemaRef: SchemaRef;
  close: () => Promise<void>;
};

const redisOptions = { maxRetriesPerRequest: 1, enableOfflineQueue: false, retryStrategy: (n: number) => Math.min(n * 200, 2000) };

export const buildServices = (env: ApiEnv, now: () => Date = () => new Date()): Services => {
  const pool = createPool(env.DATABASE_URL, 20, (e) => log('db idle error', { error: e.message }));
  const redis = new Redis(env.REDIS_URL, redisOptions);
  redis.on('error', () => undefined); // limits fall back to memory, readiness reports it
  const subscriberFactory = () => new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, retryStrategy: (n: number) => Math.min(n * 200, 2000) });
  const lim = (name: string, points: number, durationSec: number) => createLimiter(name, { points, durationSec }, redis);
  return {
    env,
    pool,
    db: createDb(pool),
    redis,
    domain: { db: createDb(pool), now, rules: rulesFromEnv(env) },
    limiters: {
      global: lim('global', env.RATE_GLOBAL_PER_MIN, 60),
      signIn: lim('signin', env.RATE_SIGNIN_PER_MIN, 60),
      signInIp: lim('signin-ip', env.RATE_SIGNIN_IP_PER_MIN, 60),
      signUp: lim('signup', env.RATE_SIGNUP_PER_HOUR, 3600),
      hold: lim('hold', env.RATE_HOLD_PER_MIN, 60),
    },
    bus: createEventBus(redis, subscriberFactory, (m) => log(m)),
    trusted: parseCidrs(env.TRUST_PROXY_CIDRS),
  };
};

/** Starts the API on `env.PORT` (0 = any free port). Used by main.ts and by the tests. */
export const createApi = async (env: ApiEnv, now?: () => Date): Promise<RunningApi> => {
  const services = buildServices(env, now);
  const schemaRef: SchemaRef = { current: null };
  const app = await NestFactory.create<NestExpressApplication>(ApiModule.register(services, schemaRef), { logger: ['error', 'warn'], bodyParser: false });
  app.useBodyParser('json', { limit: `${env.BODY_LIMIT_KB}kb` });
  app.disable('x-powered-by');
  app.enableCors({ origin: env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean), credentials: true, maxAge: 600 });

  // Per-IP limit in front of everything (GraphQL, health excluded): one noisy address gets 429s,
  // every other address is untouched. The check is a single Redis INCR, cheap enough to run first.
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/health' || req.path === '/ready') return next();
    const ip = clientIp(req.socket.remoteAddress, (h) => { const v = req.headers[h]; return Array.isArray(v) ? v[0] : v; }, services.trusted);
    const r = await services.limiters.global.consume(ip);
    if (r.ok) return next();
    res.setHeader('Retry-After', String(r.retryAfterSec));
    res.status(429).json({ errors: [{ message: 'Too many requests', extensions: { code: 'RATE_LIMITED', retryAfterSec: r.retryAfterSec } }] });
  });

  await app.init();
  schemaRef.current = app.get(GraphQLSchemaHost).schema;
  await services.bus.start();
  await app.listen(env.PORT, '0.0.0.0');
  const server = app.getHttpServer() as import('node:http').Server;
  // slow-client defences: half-sent headers / bodies are cut off instead of holding sockets forever
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 100;
  const port = (server.address() as { port: number }).port;
  return {
    app,
    url: `http://127.0.0.1:${port}`,
    port,
    services,
    schemaRef,
    close: async () => {
      await services.bus.stop();
      await app.close();
      services.redis.disconnect();
      await Promise.race([services.pool.end().catch(() => undefined), new Promise((r) => setTimeout(r, 3000).unref())]);
    },
  };
};
