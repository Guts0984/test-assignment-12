import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import type { Db } from '@clinic/db';
import type { Ctx, Actor } from '@clinic/domain';
import type { ApiEnv } from '../env.js';
import type { Loaders } from '../loaders.js';
import type { SessionUser } from '../auth/sessions.js';
import type { Limiter } from './rate-limit.js';
import type { EventBus } from './event-bus.js';
import type { Cidr } from './ip.js';

export const ENV = Symbol('API_ENV');
export const POOL = Symbol('API_POOL');
export const DB = Symbol('API_DB');
export const REDIS = Symbol('API_REDIS');
export const LIMITERS = Symbol('API_LIMITERS');
export const BUS = Symbol('API_EVENT_BUS');
export const DOMAIN = Symbol('API_DOMAIN');
export const TRUSTED = Symbol('API_TRUSTED_PROXIES');
export const SCHEMA_REF = Symbol('API_SCHEMA_REF');

import type { appointmentFromSql } from '../graphql/mapping.js';
export type VisibleAppointment = ReturnType<typeof appointmentFromSql>;

export type Limiters = {
  global: Limiter;
  cost: Limiter;
  signIn: Limiter;
  signInIp: Limiter;
  signUp: Limiter;
  hold: Limiter;
  wsConnect: Limiter;
  wsSubscribe: Limiter;
};

export type GqlContext = {
  ip: string;
  actor: Actor | null;
  user: SessionUser | null;
  token: string | null;
  loaders: Loaders;
  /** The visit if (and only if) the caller may see it. */
  visible: (id: string) => Promise<VisibleAppointment | null>;
  req?: Request;
  res?: Response;
  /** Which kind of transport produced this context. */
  transport: 'http' | 'ws';
};

export type Services = {
  env: ApiEnv;
  pool: Pool;
  db: Db;
  redis: Redis;
  domain: Ctx;
  limiters: Limiters;
  bus: EventBus;
  trusted: Cidr[];
};
