import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { sql } from 'drizzle-orm';
import { PASSWORD, codeOf, gql, login, startFixture, type Fixture } from './helpers.js';

let f: Fixture;
beforeAll(async () => { f = await startFixture(); });
afterAll(async () => { await f.stop(); });

const SIGN_IN = `mutation($i: SignInInput!){ signIn(input:$i){ id role email patientId } }`;
const SIGN_UP = `mutation($i: SignUpInput!){ signUp(input:$i){ id role email patientId } }`;
const ME = `{ me { id role email patientId clinicId doctorId } }`;

describe('sessions', () => {
  it('sign in sets an HttpOnly, SameSite=Lax cookie; me works with it and not without', async () => {
    const r = await gql(f.api, SIGN_IN, { i: { email: 'p0@t.io', password: PASSWORD } });
    expect(r.body.errors).toBeUndefined();
    const cookie = r.headers.getSetCookie().find((c) => c.startsWith('sid='));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Secure/); // COOKIE_SECURE=false in tests
    const sid = (cookie as string).split(';')[0] as string;
    const me = await gql<{ me: { email: string } }>(f.api, ME, {}, { cookie: sid });
    expect(me.body.data?.me.email).toBe('p0@t.io');
    expect((await gql<{ me: unknown }>(f.api, ME)).body.data?.me).toBeNull();
  });

  it('the token is random, long, new on every login, and only its hash is stored', async () => {
    const a = await login(f.api, 'p1@t.io');
    const b = await login(f.api, 'p1@t.io');
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(40);
    const token = a.slice(4);
    const stored = await f.t.db.execute(sql`SELECT token_hash FROM sessions`);
    expect(JSON.stringify(stored.rows)).not.toContain(token);
    expect((stored.rows as { token_hash: string }[]).every((r) => /^[0-9a-f]{64}$/.test(r.token_hash))).toBe(true);
  });

  it('sign out kills the session for good', async () => {
    const c = await login(f.api, 'p2@t.io');
    expect((await gql<{ me: unknown }>(f.api, ME, {}, { cookie: c })).body.data?.me).not.toBeNull();
    const out = await gql(f.api, `mutation { signOut }`, {}, { cookie: c });
    expect(out.headers.getSetCookie().join(';')).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect((await gql<{ me: unknown }>(f.api, ME, {}, { cookie: c })).body.data?.me).toBeNull();
  });

  it('an expired session is not accepted', async () => {
    const c = await login(f.api, 'p3@t.io');
    await f.t.db.execute(sql`UPDATE sessions SET expires_at = now() - interval '1 second'`);
    expect((await gql<{ me: unknown }>(f.api, ME, {}, { cookie: c })).body.data?.me).toBeNull();
  });

  it('forged, truncated, oversized and injection-shaped cookies are simply anonymous', async () => {
    for (const bad of ['sid=', 'sid=abc', `sid=${'A'.repeat(100)}`, `sid=${'A'.repeat(5000)}`, "sid=' OR '1'='1", 'sid=../../etc/passwd', 'sid=%00%00', 'sid; sid=2', `sid=${'a'.repeat(43)}`, 'x=y']) {
      const r = await gql<{ me: unknown }>(f.api, ME, {}, { cookie: bad });
      expect(r.status, bad.slice(0, 20)).toBe(200);
      expect(r.body.errors, bad.slice(0, 20)).toBeUndefined();
      expect(r.body.data?.me, bad.slice(0, 20)).toBeNull();
    }
  });

  it('a session does not grant another user\'s role (role comes from the database every request)', async () => {
    const c = await login(f.api, 'p4@t.io');
    await f.t.db.execute(sql`UPDATE users SET role = 'manager' WHERE email = 'p4@t.io'`);
    const me = await gql<{ me: { role: string } }>(f.api, ME, {}, { cookie: c });
    expect(me.body.data?.me.role).toBe('manager'); // current truth, not a stale claim
    await f.t.db.execute(sql`UPDATE users SET role = 'patient' WHERE email = 'p4@t.io'`);
  });
});

describe('credentials', () => {
  it('wrong password and unknown email give the same answer', async () => {
    const wrong = await gql(f.api, SIGN_IN, { i: { email: 'p5@t.io', password: 'nope-nope-nope' } });
    const unknown = await gql(f.api, SIGN_IN, { i: { email: 'nobody@t.io', password: 'nope-nope-nope' } });
    expect(codeOf(wrong)).toBe('INVALID_CREDENTIALS');
    expect(codeOf(unknown)).toBe('INVALID_CREDENTIALS');
    expect(wrong.body.errors?.[0]?.message).toBe(unknown.body.errors?.[0]?.message);
    expect(wrong.headers.getSetCookie()).toEqual([]);
  });

  it('timing does not reveal whether an account exists (same work for unknown emails)', async () => {
    const time = async (email: string) => {
      const t0 = performance.now();
      await gql(f.api, SIGN_IN, { i: { email, password: 'nope-nope-nope' } });
      return performance.now() - t0;
    };
    await time('warm@t.io');
    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < 8; i++) {
      known.push(await time('p6@t.io'));
      unknown.push(await time(`ghost${i}@t.io`));
    }
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] as number;
    // an early return for unknown emails would make them an order of magnitude faster
    expect(med(unknown)).toBeGreaterThan(med(known) * 0.4);
  });

  it('email is case-insensitive; surrounding spaces are tolerated', async () => {
    const r = await gql(f.api, SIGN_IN, { i: { email: '  P7@T.IO ', password: PASSWORD } });
    expect(r.body.errors).toBeUndefined();
  });

  it('sign up creates a patient with a session; duplicate email / phone are reported at the field', async () => {
    const input = { email: 'new@t.io', password: 'a-long-enough-pass', fullName: 'Нова Пацієнтка', phone: '+380509999001' };
    const r = await gql<{ signUp: { role: string; patientId: string } }>(f.api, SIGN_UP, { i: input });
    expect(r.body.errors).toBeUndefined();
    expect(r.body.data?.signUp.role).toBe('patient');
    expect(r.headers.getSetCookie().some((c) => c.startsWith('sid='))).toBe(true);
    const dupEmail = await gql(f.api, SIGN_UP, { i: { ...input, phone: '+380509999002' } });
    expect(codeOf(dupEmail)).toBe('EMAIL_TAKEN');
    expect(dupEmail.body.errors?.[0]?.extensions?.fieldErrors).toHaveProperty('email');
    const dupPhone = await gql(f.api, SIGN_UP, { i: { ...input, email: 'other@t.io' } });
    expect(codeOf(dupPhone)).toBe('BAD_USER_INPUT');
    expect(dupPhone.body.errors?.[0]?.extensions?.fieldErrors).toHaveProperty('phone');
    // nothing half-created: no user row without a patient row
    const orphans = await f.t.db.execute(sql`SELECT count(*)::int AS n FROM users u WHERE role = 'patient' AND NOT EXISTS (SELECT 1 FROM patients p WHERE p.user_id = u.id)`);
    expect((orphans.rows[0] as { n: number }).n).toBe(0);
  });

  it('a patient registered by phone (no account) is claimed by signing up with that number', async () => {
    await f.t.db.execute(sql`INSERT INTO patients (full_name, phone) VALUES ('Телефонний', '+380509999003')`);
    const r = await gql<{ signUp: { patientId: string } }>(f.api, SIGN_UP, { i: { email: 'phone@t.io', password: 'a-long-enough-pass', fullName: 'Телефонний', phone: '+380509999003' } });
    expect(r.body.errors).toBeUndefined();
    const n = await f.t.db.execute(sql`SELECT count(*)::int AS n FROM patients WHERE phone = '+380509999003'`);
    expect((n.rows[0] as { n: number }).n).toBe(1);
  });

  it('validation errors name the fields', async () => {
    const r = await gql(f.api, SIGN_UP, { i: { email: 'not-an-email', password: 'short', fullName: 'x', phone: '123' } });
    expect(codeOf(r)).toBe('BAD_USER_INPUT');
    const fe = r.body.errors?.[0]?.extensions?.fieldErrors ?? {};
    for (const k of ['email', 'password', 'fullName', 'phone']) expect(fe, k).toHaveProperty(k);
  });

  it('a huge password is refused before it reaches the hasher (CPU DoS guard)', async () => {
    const t0 = performance.now();
    const r = await gql(f.api, SIGN_UP, { i: { email: 'huge@t.io', password: 'x'.repeat(90_000), fullName: 'Huge', phone: '+380509999004' } });
    expect(codeOf(r)).toBe('BAD_USER_INPUT');
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe('errors never leak and never become "Internal server error" for bad input (invariant 15)', () => {
  const ops: [string, string][] = [
    ['signIn', `mutation($i: SignInInput!){ signIn(input:$i){ id } }`],
    ['availability', `query($i: AvailabilityInput!){ availability(input:$i){ clinicId } }`],
    ['clinicServices', `query($c: ID!){ clinicServices(clinicId:$c){ priceMinor } }`],
  ];
  it('garbage variables produce coded client errors', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...ops), fc.anything({ withNullPrototype: false }), async ([, q], junk) => {
        const r = await gql(f.api, q, { i: junk as never, c: junk as never });
        for (const e of r.body.errors ?? []) {
          expect(e.extensions?.code).toBeTruthy();
          expect(e.extensions?.code).not.toBe('INTERNAL_SERVER_ERROR');
          expect(e.message).not.toMatch(/at .*\(.*:\d+:\d+\)|node_modules|drizzle|SELECT /i);
        }
        expect(r.status).toBeLessThan(500);
      }),
      { numRuns: 60 },
    );
  });
  it('hostile ids and dates in real arguments', async () => {
    for (const id of ["' OR 1=1 --", 'not-a-uuid', '', '\u0000', 'ǵ'.repeat(500), '00000000-0000-4000-8000-000000000000']) {
      const r = await gql(f.api, `query($c: ID!){ clinicServices(clinicId:$c){ priceMinor } }`, { c: id });
      expect(codeOf(r) ?? 'none', id.slice(0, 10)).not.toBe('INTERNAL_SERVER_ERROR');
    }
    for (const d of ['2026-02-30', 'yesterday', '0000-00-00', "2026-01-01'; DROP TABLE users;--"]) {
      const r = await gql(f.api, `query($i: AvailabilityInput!){ availability(input:$i){ clinicId } }`, { i: { clinicId: f.w.kyiv, serviceId: f.w.c30, fromDate: d } });
      expect(codeOf(r), d).toBe('BAD_USER_INPUT');
    }
    expect((await f.t.db.execute(sql`SELECT count(*)::int AS n FROM users`)).rows[0]).toBeTruthy();
  });
  it('malformed GraphQL / JSON bodies are 4xx with a code, not 500', async () => {
    const bodies = ['{', '[]', '{"query": 5}', '{"query":"{ nonexistent }"}', 'null', '{"query":"query { clinics { id "}'];
    for (const b of bodies) {
      const res = await fetch(`${f.api.url}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: b });
      expect(res.status, b).toBeLessThan(500);
      const text = await res.text();
      expect(text).not.toMatch(/INTERNAL_SERVER_ERROR/);
    }
  });
});
