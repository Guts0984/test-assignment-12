import net from 'node:net';
import { execSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  PASSWORD,
  at,
  codeOf,
  gql,
  login,
  sleep,
  startFixture,
  workday,
  type Fixture,
  type World,
} from './helpers.js';

// A real API on a real socket; the "attacker" and the "victim" are different source addresses
// (127.0.0.2, 127.0.0.3 ... all loopback), which is exactly what per-IP limiting must tell apart.
const ATTACKER = '127.0.0.2';
const VICTIM = '127.0.0.3';
const OTHER = '127.0.0.4';

let f: Fixture;
let w: World;

beforeAll(async () => {
  f = await startFixture({
    RATE_GLOBAL_PER_MIN: '120',
    RATE_SIGNIN_PER_MIN: '5',
    RATE_SIGNIN_IP_PER_MIN: '20',
    RATE_SIGNUP_PER_HOUR: '5',
    RATE_HOLD_PER_MIN: '10',
  });
  w = f.w;
});
afterAll(async () => {
  await f.stop();
});

const ping = (who: { ip: string; headers?: Record<string, string> }) =>
  gql(f.api, `{ clinics { id } }`, {}, who);
const p95 = (xs: number[]): number =>
  [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1] as number;
const resetLimits = async (): Promise<void> => {
  await f.api.services.redis.flushall().catch(() => undefined);
  // the in-memory fallback limiter keeps its own counters; a fresh minute is simulated by waiting out nothing here
};

describe('one abusive address cannot take the API away from everybody else', () => {
  it('600 requests from one IP: it is throttled with 429 + Retry-After; a neighbour is served normally meanwhile', async () => {
    await resetLimits();
    const victimTimes: number[] = [];
    const victimStatus: number[] = [];
    let stop = false;
    const victimLoop = (async () => {
      while (!stop) {
        const t0 = performance.now();
        const r = await ping({ ip: VICTIM });
        victimTimes.push(performance.now() - t0);
        victimStatus.push(r.status);
        await sleep(40);
      }
    })();
    const results: { status: number; retry: string | null }[] = [];
    const batch = async (n: number) => {
      const rs = await Promise.all(Array.from({ length: n }, () => ping({ ip: ATTACKER })));
      for (const r of rs) results.push({ status: r.status, retry: r.headers.get('retry-after') });
    };
    for (let i = 0; i < 6; i++) await batch(100);
    stop = true;
    await victimLoop;
    const limited = results.filter((r) => r.status === 429);
    expect(results.filter((r) => r.status === 200).length).toBeLessThanOrEqual(125);
    expect(limited.length).toBeGreaterThanOrEqual(470);
    expect(limited.every((r) => Number(r.retry) >= 1 && Number(r.retry) <= 60)).toBe(true);
    expect(victimStatus.length).toBeGreaterThan(3);
    expect(victimStatus.every((s) => s === 200)).toBe(true);
    expect(p95(victimTimes)).toBeLessThan(400);
  });

  it('a throttled response is a clean GraphQL-shaped error with the right code', async () => {
    const r = await ping({ ip: ATTACKER });
    expect(r.status).toBe(429);
    expect(codeOf(r)).toBe('RATE_LIMITED');
  });

  it('spoofed X-Forwarded-For / X-Real-IP from an untrusted peer change nothing: the socket address is the key', async () => {
    // attacker is already over budget; pretending to be the neighbour does not help it...
    const spoof = await ping({
      ip: ATTACKER,
      headers: { 'x-forwarded-for': VICTIM, 'x-real-ip': VICTIM },
    });
    expect(spoof.status).toBe(429);
    // ...and does not burn the neighbour's budget either: 300 spoofed requests "as" the victim
    await resetLimits();
    const a = await Promise.all(
      Array.from({ length: 300 }, (_, i) =>
        ping({
          ip: ATTACKER,
          headers: { 'x-forwarded-for': `${VICTIM}, 10.0.0.${i % 250}`, 'x-real-ip': VICTIM },
        }),
      ),
    );
    expect(a.filter((r) => r.status === 429).length).toBeGreaterThan(150);
    const v = await Promise.all(Array.from({ length: 40 }, () => ping({ ip: VICTIM })));
    expect(v.every((r) => r.status === 200)).toBe(true);
  });

  it('rotating the forwarded header on every request does not evade the limit', async () => {
    await resetLimits();
    await sleep(50);
    const rs = await Promise.all(
      Array.from({ length: 260 }, (_, i) =>
        ping({
          ip: OTHER,
          headers: {
            'x-forwarded-for': `203.0.113.${i % 250}`,
            forwarded: `for=198.51.100.${i % 250}`,
          },
        }),
      ),
    );
    expect(rs.filter((r) => r.status === 429).length).toBeGreaterThan(100);
  });

  it('health checks are never throttled (orchestrators must reach them)', async () => {
    const rs = await Promise.all(Array.from({ length: 300 }, () => fetch(`${f.api.url}/health`)));
    expect(rs.every((r) => r.status === 200)).toBe(true);
  });

  it('hundreds of half-open connections from one address do not stall other clients', async () => {
    const socks: net.Socket[] = [];
    await Promise.all(
      Array.from(
        { length: 250 },
        () =>
          new Promise<void>((resolve) => {
            const s = net.connect(
              { host: '127.0.0.1', port: f.api.port, localAddress: ATTACKER },
              () => {
                s.write(
                  'POST /graphql HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{',
                ); // never finishes
                resolve();
              },
            );
            s.on('error', () => resolve());
            socks.push(s);
          }),
      ),
    );
    const times: number[] = [];
    for (let i = 0; i < 15; i++) {
      const t0 = performance.now();
      const r = await ping({ ip: VICTIM });
      times.push(performance.now() - t0);
      expect(r.status).toBe(200);
    }
    expect(p95(times)).toBeLessThan(500);
    socks.forEach((s) => s.destroy());
  });
});

describe('trusted reverse proxy mode', () => {
  let p: Fixture;
  beforeAll(async () => {
    p = await startFixture({ RATE_GLOBAL_PER_MIN: '30', TRUST_PROXY_CIDRS: '127.0.0.0/24' });
  });
  afterAll(async () => {
    await p.stop();
  });
  // behind nginx: the peer is the proxy; nginx APPENDS the real client address to whatever the client sent
  const viaProxy = (realClient: string, clientSuppliedXff = '') =>
    gql(
      p.api,
      `{ clinics { id } }`,
      {},
      {
        ip: '127.0.0.9',
        headers: {
          'x-forwarded-for': clientSuppliedXff ? `${clientSuppliedXff}, ${realClient}` : realClient,
        },
      },
    );

  it('limits are per real client behind the proxy, and client-supplied header prefixes cannot dodge them', async () => {
    const bad = await Promise.all(
      Array.from({ length: 80 }, (_, i) => viaProxy('198.51.100.7', `1.2.3.${i}, 5.6.7.${i}`)),
    );
    expect(bad.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(45);
    const other = await Promise.all(Array.from({ length: 20 }, () => viaProxy('198.51.100.8')));
    expect(other.every((r) => r.status === 200)).toBe(true); // a different client behind the same proxy is untouched
  });

  it('a peer that is NOT a trusted proxy cannot use the header even when proxies are trusted', async () => {
    const rs = await Promise.all(
      Array.from({ length: 60 }, (_, i) =>
        gql(
          p.api,
          `{ clinics { id } }`,
          {},
          {
            ip: '127.0.1.5'.replace('127.0.1', '127.0.1'),
            headers: { 'x-forwarded-for': `9.9.9.${i}` },
          },
        ),
      ),
    );
    // 127.0.1.5 is outside 127.0.0.0/24: its own address is the key, so rotating the header does not help
    expect(rs.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(25);
  });
});

describe('credential attacks', () => {
  it('guessing one account: the 6th attempt in a minute is refused — even with the right password', async () => {
    const attempt = (pw: string, ip: string) =>
      gql(
        f.api,
        `mutation($i: SignInInput!){ signIn(input:$i){ id } }`,
        { i: { email: 'p10@t.io', password: pw } },
        { ip },
      );
    const codes: (string | undefined)[] = [];
    for (let i = 0; i < 5; i++) codes.push(codeOf(await attempt(`wrong-password-${i}`, ATTACKER)));
    expect(codes).toEqual(Array(5).fill('INVALID_CREDENTIALS'));
    const sixth = await attempt(PASSWORD, ATTACKER);
    expect(codeOf(sixth)).toBe('RATE_LIMITED');
    expect(sixth.body.errors?.[0]?.extensions?.retryAfterSec).toBeGreaterThan(0);
    expect(sixth.headers.getSetCookie()).toEqual([]);
    // the owner of the account, from another address, signs in without trouble (no lockout DoS)
    const owner = await attempt(PASSWORD, VICTIM);
    expect(owner.body.errors).toBeUndefined();
    expect(owner.headers.getSetCookie().some((c) => c.startsWith('sid='))).toBe(true);
  });

  it('password spraying: 21 different accounts from one address in a minute → throttled; others unaffected', async () => {
    const spray = (i: number) =>
      gql(
        f.api,
        `mutation($i: SignInInput!){ signIn(input:$i){ id } }`,
        { i: { email: `user${i}@t.io`, password: 'Summer2026!!' } },
        { ip: OTHER },
      );
    const rs = [];
    for (let i = 0; i < 24; i++) rs.push(await spray(i));
    const codes = rs.map(codeOf);
    expect(codes.filter((c) => c === 'INVALID_CREDENTIALS').length).toBeLessThanOrEqual(20);
    expect(codes.filter((c) => c === 'RATE_LIMITED').length).toBeGreaterThanOrEqual(4);
    const fine = await gql(
      f.api,
      `mutation($i: SignInInput!){ signIn(input:$i){ id } }`,
      { i: { email: 'p11@t.io', password: PASSWORD } },
      { ip: '127.0.0.5' },
    );
    expect(fine.body.errors).toBeUndefined();
  });

  it('registration spam: 5 sign-ups per hour per address, nothing created beyond that', async () => {
    const before = Number(
      (await f.t.db.execute(sql`SELECT count(*)::int AS n FROM users`)).rows[0]
        ? (
            (await f.t.db.execute(sql`SELECT count(*)::int AS n FROM users`)).rows[0] as {
              n: number;
            }
          ).n
        : 0,
    );
    const codes: (string | undefined)[] = [];
    for (let i = 0; i < 9; i++) {
      const r = await gql(
        f.api,
        `mutation($i: SignUpInput!){ signUp(input:$i){ id } }`,
        {
          i: {
            email: `spam${i}@t.io`,
            password: 'a-long-enough-pass',
            fullName: 'Spam Bot',
            phone: `+38050777000${i}`,
          },
        },
        { ip: '127.0.0.6' },
      );
      codes.push(codeOf(r));
    }
    expect(codes.filter((c) => c === undefined)).toHaveLength(5);
    expect(codes.filter((c) => c === 'RATE_LIMITED')).toHaveLength(4);
    const after = (
      (await f.t.db.execute(sql`SELECT count(*)::int AS n FROM users`)).rows[0] as { n: number }
    ).n;
    expect(after - before).toBe(5);
  });
});

describe('booking abuse', () => {
  it('hold spam: 10 per minute per account; one account can never freeze more than one time slot', async () => {
    const cookie = await login(f.api, 'p12@t.io', '127.0.0.7');
    const hold = (i: number) =>
      gql(
        f.api,
        `mutation($i: HoldSlotInput!){ holdSlot(input:$i){ id } }`,
        {
          i: {
            clinicId: w.kyiv,
            doctorId: w.kyivDoctors[i % 6],
            serviceId: w.c30,
            startsAt: at(workday(10 + Math.floor(i / 6)), '10:00').toISOString(),
          },
        },
        { cookie, ip: '127.0.0.7' },
      );
    const codes: (string | undefined)[] = [];
    for (let i = 0; i < 14; i++) codes.push(codeOf(await hold(i)));
    expect(codes.filter((c) => c === undefined)).toHaveLength(10);
    expect(codes.filter((c) => c === 'RATE_LIMITED')).toHaveLength(4);
    const live = await f.t.db.execute(
      sql`SELECT count(*)::int AS n FROM appointments WHERE patient_id = ${w.patients[12]!.id}::uuid AND status = 'held'`,
    );
    expect((live.rows[0] as { n: number }).n).toBe(1); // 10 holds, one survives
    // another account's holds are not affected by this one's budget
    const c2 = await login(f.api, 'p13@t.io', '127.0.0.8');
    const ok = await gql(
      f.api,
      `mutation($i: HoldSlotInput!){ holdSlot(input:$i){ id } }`,
      {
        i: {
          clinicId: w.kyiv,
          doctorId: w.kyivDoctors[0],
          serviceId: w.c30,
          startsAt: at(workday(30), '10:00').toISOString(),
        },
      },
      { cookie: c2, ip: '127.0.0.8' },
    );
    expect(ok.body.errors).toBeUndefined();
  });
});

describe('Redis trouble must not take the API down or open the gates', () => {
  it('with Redis stopped: pages keep working, limits still bite (in-memory fallback), readiness reports it; recovers afterwards', async () => {
    const id = inject('redisContainerId');
    execSync(`docker stop ${id}`, { stdio: 'ignore' });
    try {
      await sleep(500);
      expect((await fetch(`${f.api.url}/health`)).status).toBe(200);
      const ready = await fetch(`${f.api.url}/ready`);
      expect(ready.status).toBe(503);
      expect(((await ready.json()) as { redis: boolean }).redis).toBe(false);
      const ok = await ping({ ip: VICTIM });
      expect(ok.status).toBe(200);
      const flood = await Promise.all(
        Array.from({ length: 200 }, () => ping({ ip: '127.0.0.10' })),
      );
      expect(flood.filter((r) => r.status === 429).length).toBeGreaterThan(60); // still limited without Redis
      expect(flood.filter((r) => r.status >= 500)).toHaveLength(0);
    } finally {
      execSync(`docker start ${id}`, { stdio: 'ignore' });
    }
    for (let i = 0; i < 60; i++) {
      const r = await fetch(`${f.api.url}/ready`);
      if (r.status === 200) break;
      await sleep(250);
    }
    expect((await fetch(`${f.api.url}/ready`)).status).toBe(200);
  });
});
