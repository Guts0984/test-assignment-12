import { inject } from 'vitest';
import http from 'node:http';
import WebSocket from 'ws';
import { createClient, type Client } from 'graphql-ws';
import { sql } from 'drizzle-orm';
import { hashPassword } from '../src/auth/password.js';
import { createApi, type RunningApi } from '../src/app.js';
import { loadApiEnv, type ApiEnv } from '../src/env.js';
import { makeWorld, createTestDb, type TestDb, type World } from './helpers-domain.js';

export * from './helpers-domain.js';

export const PASSWORD = 'Sup3r-secret-pass!';
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const apiEnv = (dbUrl: string, over: Record<string, string> = {}): ApiEnv =>
  loadApiEnv({
    NODE_ENV: 'test',
    PORT: '0',
    DATABASE_URL: dbUrl,
    REDIS_URL: inject('redisUrl'),
    ARGON_MEMORY_KIB: '1024',
    ARGON_TIME_COST: '1',
    RATE_GLOBAL_PER_MIN: '100000',
    RATE_SIGNIN_PER_MIN: '100000',
    RATE_SIGNIN_IP_PER_MIN: '100000',
    RATE_SIGNUP_PER_HOUR: '100000',
    RATE_HOLD_PER_MIN: '100000',
    ...over,
  });

export type Fixture = { t: TestDb; w: World; api: RunningApi; stop: () => Promise<void> };

/** A migrated database with a small world, every user given the same real password, and the API running on it. */
export const startFixture = async (over: Record<string, string> = {}): Promise<Fixture> => {
  const t = await createTestDb(40);
  const w = await makeWorld(t.db);
  const hash = await hashPassword(PASSWORD, { memoryCost: 1024, timeCost: 1 });
  await t.db.execute(sql`UPDATE users SET password_hash = ${hash}`);
  const api = await createApi(apiEnv(t.url, over));
  return {
    t, w, api,
    stop: async () => {
      await api.close();
      await t.drop();
    },
  };
};

// ---------- HTTP ----------
// node:http (not fetch): it honours `localAddress`, which lets the tests act as different client
// addresses (127.0.0.2, 127.0.0.3 …) against the real listening server.
export type GqlResponse<T = unknown> = { status: number; headers: Headers; body: { data?: T | null; errors?: { message: string; extensions?: { code?: string; fieldErrors?: Record<string, string>; retryAfterSec?: number } }[] } };

export type Caller = { cookie?: string; ip?: string; headers?: Record<string, string> };

export const rawPost = (api: RunningApi, path: string, payload: string, who: Caller = {}): Promise<{ status: number; headers: Headers; text: string }> =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1', port: api.port, path, method: 'POST', agent: false,
        ...(who.ip ? { localAddress: who.ip } : {}),
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), ...(who.cookie ? { cookie: who.cookie } : {}), ...who.headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const headers = new Headers();
          for (const [k, v] of Object.entries(res.headers)) for (const x of Array.isArray(v) ? v : [String(v)]) headers.append(k, x);
          resolve({ status: res.statusCode ?? 0, headers, text: Buffer.concat(chunks).toString('utf8') });
        });
      },
    );
    req.on('error', reject);
    req.end(payload);
  });

export const gql = async <T = Record<string, unknown>>(api: RunningApi, query: string, variables: Record<string, unknown> = {}, who: Caller = {}): Promise<GqlResponse<T>> => {
  const r = await rawPost(api, '/graphql', JSON.stringify({ query, variables }), who);
  let body: GqlResponse['body'];
  try { body = JSON.parse(r.text); } catch { body = { errors: [{ message: r.text.slice(0, 200) }] }; }
  return { status: r.status, headers: r.headers, body: body as GqlResponse<T>['body'] };
};

export const codeOf = (r: GqlResponse): string | undefined => r.body.errors?.[0]?.extensions?.code;

/** Signs in and returns the session cookie. */
export const login = async (api: RunningApi, email: string, ip?: string): Promise<string> => {
  const r = await gql(api, `mutation($i: SignInInput!){ signIn(input:$i){ id role } }`, { i: { email, password: PASSWORD } }, ip ? { ip } : {});
  const sc = r.headers.getSetCookie().find((c) => c.startsWith('sid='));
  if (!sc) throw new Error(`login failed for ${email}: ${JSON.stringify(r.body)}`);
  return (sc.split(';')[0]) as string;
};

// ---------- WebSocket ----------
export type Sub = { events: unknown[]; errors: unknown[]; done: Promise<void>; dispose: () => void };

export const wsClient = (api: RunningApi, who: Caller = {}): Client => {
  class Cookied extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols, { headers: who.cookie ? { cookie: who.cookie } : {}, ...(who.ip ? { localAddress: who.ip } : {}) });
    }
  }
  return createClient({ url: `ws://127.0.0.1:${api.port}/graphql`, webSocketImpl: Cookied, retryAttempts: 0, lazy: true });
};

export const subscribe = (client: Client, query: string, variables: Record<string, unknown> = {}): Sub => {
  const events: unknown[] = [];
  const errors: unknown[] = [];
  let dispose = (): void => undefined;
  const done = new Promise<void>((resolve) => {
    dispose = client.subscribe({ query, variables }, {
      next: (v) => events.push(v.data),
      error: (e) => { errors.push(e); resolve(); },
      complete: () => resolve(),
    });
  });
  return { events, errors, done, dispose };
};

export const waitUntil = async (pred: () => boolean, ms = 8000): Promise<boolean> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    await sleep(50);
  }
  return pred();
};
