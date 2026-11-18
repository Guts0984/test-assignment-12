import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { at, codeOf, gql, login, startFixture, workday, type Fixture, type World } from './helpers.js';

let f: Fixture;
let prod: Fixture;
let cost: Fixture;
let w: World;
let reg = '';

beforeAll(async () => {
  f = await startFixture({ GQL_MAX_DEPTH: '10', GQL_MAX_COMPLEXITY: '100000000' }); // depth is what these tests probe
  cost = await startFixture(); // default cost limit
  prod = await startFixture({ NODE_ENV: 'production' });
  w = f.w;
  reg = await login(f.api, 'rk@t.io');
});
afterAll(async () => { await f.stop(); await prod.stop(); await cost.stop(); });

const nest = (n: number, leaf = 'id'): string => (n === 0 ? leaf : `patient { visits { ${nest(n - 1, leaf)} } }`);

describe('GraphQL cannot be used to knock the server over (invariant 14)', () => {
  it('a query 15 levels deep is refused; a normal one is fine', async () => {
    const deep = await gql(f.api, `query($c: ID!, $d: String!){ clinicBoard(clinicId:$c, date:$d){ ${nest(7)} } }`, { c: w.kyiv, d: workday(1) }, { cookie: reg });
    expect(codeOf(deep)).toBe('QUERY_TOO_COMPLEX');
    expect(deep.body.errors?.[0]?.message).toMatch(/deep/);
    const ok = await gql(f.api, `query($c: ID!, $d: String!){ clinicBoard(clinicId:$c, date:$d){ id doctor { id } patient { id visits { id } } } }`, { c: w.kyiv, d: workday(1) }, { cookie: reg });
    expect(ok.body.errors).toBeUndefined();
  });

  it('exactly at the depth limit passes, one more does not', async () => {
    const at10 = (n: number) => `query($c: ID!, $d: String!){ clinicBoard(clinicId:$c, date:$d){ ${nest(n)} } }`; // depth = 1 + 2n + 1
    expect(codeOf(await gql(f.api, at10(4), { c: w.kyiv, d: workday(1) }, { cookie: reg }))).toBeUndefined(); // 10 levels
    expect(codeOf(await gql(f.api, at10(5), { c: w.kyiv, d: workday(1) }, { cookie: reg }))).toBe('QUERY_TOO_COMPLEX'); // 12 levels
  });

  it('an alias bomb (thousands of aliases) is refused before executing anything', async () => {
    const aliases = Array.from({ length: 3000 }, (_, i) => `a${i}: clinics { id }`).join(' ');
    const t0 = performance.now();
    const r = await gql(f.api, `{ ${aliases} }`);
    expect(codeOf(r)).toBe('QUERY_TOO_COMPLEX');
    expect(performance.now() - t0).toBeLessThan(3000);
    // and the server is still answering normally
    expect((await gql(f.api, `{ clinics { id } }`)).body.errors).toBeUndefined();
  });

  it('an expensive list query (many items × many relations) is refused by cost, a modest one is fine', async () => {
    const heavy = `query { myAppointments(limit: 100) { id doctor { id fullName specialty } clinic { id city timeZone } service { id nameUk nameEn namePl } patient { id fullName phone email visits { id doctor { id } } } events { type at actorRole reason } } }`;
    const p = await login(cost.api, 'p0@t.io');
    const r = await gql(cost.api, heavy, {}, { cookie: p });
    expect(codeOf(r)).toBe('QUERY_TOO_COMPLEX');
    expect(r.body.errors?.[0]?.message).toMatch(/expensive/);
    const light = `query { myAppointments(limit: 5) { id doctor { id fullName } service { id nameUk } } }`;
    expect((await gql(cost.api, light, {}, { cookie: p })).body.errors).toBeUndefined();
  });

  it('fragment cycles and unknown fragments are validation errors, not hangs or crashes', async () => {
    const cyc = `query { clinics { ...A } } fragment A on Clinic { id ...B } fragment B on Clinic { city ...A }`;
    const t0 = performance.now();
    const r = await gql(f.api, cyc);
    expect(r.body.errors?.length).toBeGreaterThan(0);
    expect(codeOf(r)).not.toBe('INTERNAL_SERVER_ERROR');
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(codeOf(await gql(f.api, `query { clinics { ...Nope } }`))).not.toBe('INTERNAL_SERVER_ERROR');
  });

  it('a deep fragment chain cannot sneak past the depth limit', async () => {
    const n = 14;
    const frags = Array.from({ length: n }, (_, i) => `fragment F${i} on Appointment { patient { visits { ...F${i + 1} } } }`).join(' ') + ` fragment F${n} on Appointment { id }`;
    const r = await gql(f.api, `query($c: ID!, $d: String!){ clinicBoard(clinicId:$c, date:$d){ ...F0 } } ${frags}`, { c: w.kyiv, d: workday(1) }, { cookie: reg });
    expect(codeOf(r)).toBe('QUERY_TOO_COMPLEX');
  });

  it('batched requests (JSON arrays) are not accepted', async () => {
    const res = await fetch(`${f.api.url}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Array.from({ length: 50 }, () => ({ query: '{ clinics { id } }' }))) });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('an oversized request body is refused outright', async () => {
    const res = await fetch(`${f.api.url}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: `{ clinics { id } } #${'x'.repeat(300_000)}` }) });
    expect(res.status).toBe(413);
    expect((await fetch(`${f.api.url}/health`)).status).toBe(200);
  });

  it('a request with huge variables is refused too', async () => {
    const res = await fetch(`${f.api.url}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'query($i: SignInInput!){ signIn(input:$i){ id } }', variables: { i: { email: 'a@b.io', password: 'x'.repeat(200_000) } } }) });
    expect(res.status).toBe(413);
  });
});

describe('introspection and the playground are off in production', () => {
  it('production refuses __schema and __type, development allows them', async () => {
    const q = `{ __schema { types { name } } }`;
    const p = await gql(prod.api, q);
    expect(p.body.errors?.[0]?.message).toMatch(/introspection/i);
    expect(p.body.data ?? null).toBeNull();
    expect(JSON.stringify((await gql(prod.api, `{ __type(name: "Appointment") { fields { name } } }`)).body)).not.toContain('"fields"');
    expect((await gql(f.api, q)).body.data).toBeTruthy();
  });
  it('production serves no landing page / sandbox on GET', async () => {
    const res = await fetch(`${prod.api.url}/graphql`, { headers: { accept: 'text/html' } });
    const body = await res.text();
    expect(body).not.toMatch(/sandbox|apollo-server-landing-page|Explorer/i);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
  it('field suggestions do not leak the schema in production ("Did you mean")', async () => {
    const r = await gql(prod.api, `{ clinicz { id } }`);
    expect(JSON.stringify(r.body)).not.toMatch(/Did you mean/i);
  });
});

describe('cross-site request forgery', () => {
  it('simple cross-site requests (text/plain, form posts, GET) are refused', async () => {
    const cookie = await login(f.api, 'p0@t.io');
    const mut = `mutation { signOut }`;
    for (const [type, body] of [['text/plain', JSON.stringify({ query: mut })], ['application/x-www-form-urlencoded', `query=${encodeURIComponent(mut)}`]] as const) {
      const res = await fetch(`${f.api.url}/graphql`, { method: 'POST', headers: { 'content-type': type, cookie }, body });
      expect(res.status, type).toBeGreaterThanOrEqual(400);
    }
    const g = await fetch(`${f.api.url}/graphql?query=${encodeURIComponent(mut)}`, { headers: { cookie } });
    expect(g.status).toBeGreaterThanOrEqual(400);
    // the session survived all of it
    expect(((await gql<{ me: unknown }>(f.api, `{ me { id } }`, {}, { cookie })).body.data as { me: unknown }).me).not.toBeNull();
  });
  it('CORS: only the configured origin is allowed to send credentialed requests', async () => {
    const ok = await fetch(`${f.api.url}/graphql`, { method: 'OPTIONS', headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(ok.headers.get('access-control-allow-credentials')).toBe('true');
    const evil = await fetch(`${f.api.url}/graphql`, { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });
  it('no framework fingerprint header', async () => {
    const res = await fetch(`${f.api.url}/health`);
    expect(res.headers.get('x-powered-by')).toBeNull();
  });
});

describe('DataLoader: a list of 50 visits with doctor, clinic, service and patient costs a fixed number of queries', () => {
  beforeAll(async () => {
    const day = workday(5);
    const times = ['09:00', '09:45', '10:30', '11:15', '12:00', '14:00', '14:45', '15:30', '16:15'];
    let i = 0;
    for (const doctor of w.kyivDoctors) {
      for (const tm of times) {
        const start = at(day, tm);
        await f.t.db.execute(sql`INSERT INTO appointments (patient_id, doctor_id, clinic_id, service_id, starts_at, ends_at, occupied_until, local_date, status, price_minor, currency)
          VALUES (${w.patients[i++ % 40]!.id}::uuid, ${doctor}::uuid, ${w.kyiv}::uuid, ${w.c30}::uuid, ${start.toISOString()}::timestamptz, ${new Date(start.getTime() + 30 * 60_000).toISOString()}::timestamptz,
                  ${start.toISOString()}::timestamptz, '2000-01-01', 'booked', 1000, 'UAH')`);
      }
    }
  });

  const countQueries = async (fn: () => Promise<unknown>): Promise<number> => {
    const pool = f.api.services.pool;
    const orig = pool.query.bind(pool) as (...a: unknown[]) => unknown;
    let n = 0;
    (pool as unknown as { query: unknown }).query = (...a: unknown[]) => { n++; return orig(...a); };
    try { await fn(); } finally { (pool as unknown as { query: unknown }).query = orig; }
    return n;
  };
  const LIST = `query($c: ID!, $d: String!){ clinicBoard(clinicId:$c, date:$d){ id status doctor { id fullName } clinic { id city } service { id nameUk } patient { id fullName phone } } }`;

  it('54 visits: the same small number of SQL queries as for 3', async () => {
    const big = await countQueries(async () => {
      const r = await gql<{ clinicBoard: unknown[] }>(f.api, LIST, { c: w.kyiv, d: workday(5) }, { cookie: reg });
      expect(r.body.data?.clinicBoard.length).toBe(54);
    });
    await f.t.db.execute(sql`UPDATE appointments SET status = 'cancelled' WHERE id NOT IN (SELECT id FROM appointments ORDER BY starts_at LIMIT 3) AND local_date = ${workday(5)}::date`);
    const small = await countQueries(async () => {
      const r = await gql<{ clinicBoard: unknown[] }>(f.api, LIST, { c: w.kyiv, d: workday(5) }, { cookie: reg });
      expect(r.body.data?.clinicBoard.length).toBeGreaterThanOrEqual(3);
    });
    expect(big).toBe(small);
    expect(big).toBeLessThanOrEqual(8); // session + list + doctor + clinic + service + patient (+ margin)
  });
});
