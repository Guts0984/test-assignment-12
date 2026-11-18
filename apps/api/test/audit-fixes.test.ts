import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { parse } from 'graphql';
import { estimateCost } from '../src/infra/security.js';
import {
  at,
  codeOf,
  gql,
  login,
  sleep,
  startFixture,
  subscribe,
  waitUntil,
  wsClient,
  workday,
  type Fixture,
  type World,
} from './helpers.js';

let f: Fixture; // default cost limit
let budget: Fixture; // tiny per-IP cost budget
let w: World;

beforeAll(async () => {
  f = await startFixture();
  budget = await startFixture({ RATE_COST_PER_MIN: '150' });
  w = f.w;
});
afterAll(async () => {
  await f.stop();
  await budget.stop();
});

const insertPast = async (
  patient: string,
  doctor: number,
  iso: string,
  status: 'booked' | 'cancelled' | 'completed',
): Promise<string> => {
  const start = new Date(iso);
  const r = await f.t.db.execute(sql`
    INSERT INTO appointments (patient_id, doctor_id, clinic_id, service_id, starts_at, ends_at, status, price_minor, currency, booked_at)
    VALUES (${patient}::uuid, ${w.kyivDoctors[doctor]}::uuid, ${w.kyiv}::uuid, ${w.c30}::uuid, ${start.toISOString()}::timestamptz, ${new Date(start.getTime() + 1_800_000).toISOString()}::timestamptz, ${status}, 70000, 'UAH', ${start.toISOString()}::timestamptz)
    RETURNING id`);
  return String((r.rows[0] as { id: string }).id);
};

describe("myAppointments PAST scope only ever returns the caller's own visits (audit: CRITICAL)", () => {
  it('two patients with past and cancelled visits each see only their own', async () => {
    const [a, b] = [w.patients[10]!, w.patients[11]!];
    const aIds = [
      await insertPast(a.id, 0, '2025-03-10T09:00:00Z', 'completed'),
      await insertPast(a.id, 1, '2025-03-11T09:00:00Z', 'cancelled'),
    ];
    const bIds = [
      await insertPast(b.id, 2, '2025-03-10T10:00:00Z', 'completed'),
      await insertPast(b.id, 3, '2025-03-11T10:00:00Z', 'cancelled'),
      await insertPast(b.id, 4, '2025-03-12T10:00:00Z', 'booked'),
    ];
    const q = `query { myAppointments(scope: PAST, limit: 100) { id patient { id } } }`;
    const ca = await login(f.api, 'p10@t.io');
    const cb = await login(f.api, 'p11@t.io');
    const ra = await gql<{ myAppointments: { id: string; patient: { id: string } }[] }>(
      f.api,
      q,
      {},
      { cookie: ca },
    );
    const rb = await gql<{ myAppointments: { id: string }[] }>(f.api, q, {}, { cookie: cb });
    expect(ra.body.errors).toBeUndefined();
    const idsA = ra.body.data!.myAppointments.map((x) => x.id).sort();
    const idsB = rb.body.data!.myAppointments.map((x) => x.id).sort();
    expect(idsA).toEqual([...aIds].sort());
    expect(idsB).toEqual([...bIds].sort());
    for (const x of ra.body.data!.myAppointments) expect(x.patient.id).toBe(a.id);
    // direct lookup of somebody else's visit and nested visits stay private too
    const other = await gql<{ appointment: unknown }>(
      f.api,
      `query($i: ID!){ appointment(id:$i){ id } }`,
      { i: bIds[0] },
      { cookie: ca },
    );
    expect(other.body.data?.appointment).toBeNull();
    const nested = await gql<{ myAppointments: { patient: { visits: { id: string }[] } }[] }>(
      f.api,
      `query { myAppointments(scope: PAST, limit: 5) { patient { visits { id } } } }`,
      {},
      { cookie: ca },
    );
    for (const x of nested.body.data!.myAppointments)
      for (const v of x.patient.visits) expect(bIds).not.toContain(v.id);
  });
});

describe('sign-up never claims an existing patient record (audit: CRITICAL account takeover)', () => {
  it('a phone-booked patient with visits stays untouched and sign-up with that phone is rejected', async () => {
    const phone = '+380509990001';
    const ins = await f.t.db.execute(
      sql`INSERT INTO patients (full_name, phone, email) VALUES ('Victim', ${phone}, 'victim@t.io') RETURNING id`,
    );
    const pid = String((ins.rows[0] as { id: string }).id);
    const vid = await insertPast(pid, 5, '2025-04-10T09:00:00Z', 'completed');
    const r = await gql(f.api, `mutation($i: SignUpInput!){ signUp(input:$i){ id patientId } }`, {
      i: { email: 'attacker@t.io', password: 'a-long-enough-pass', fullName: 'Attacker', phone },
    });
    expect(codeOf(r)).toBe('BAD_USER_INPUT');
    expect(r.body.errors?.[0]?.extensions?.fieldErrors).toHaveProperty('phone');
    expect(JSON.stringify(r.body)).not.toMatch(/Victim|victim@t\.io/);
    const row = (
      await f.t.db.execute(
        sql`SELECT user_id, email, full_name FROM patients WHERE id = ${pid}::uuid`,
      )
    ).rows[0] as { user_id: string | null; email: string; full_name: string };
    expect(row).toEqual({ user_id: null, email: 'victim@t.io', full_name: 'Victim' });
    const u = await f.t.db.execute(
      sql`SELECT count(*)::int AS n FROM users WHERE email = 'attacker@t.io'`,
    );
    expect((u.rows[0] as { n: number }).n).toBe(0); // the whole sign-up rolled back
    const v = await f.t.db.execute(
      sql`SELECT patient_id FROM appointments WHERE id = ${vid}::uuid`,
    );
    expect((v.rows[0] as { patient_id: string }).patient_id).toBe(pid);
  });
});

describe('query cost cannot be dodged (audit: HIGH)', () => {
  const avail = (n: number): string =>
    `query($i: AvailabilityInput!){ ${Array.from({ length: n }, (_, i) => `a${i}: availability(input:$i){ durationMin }`).join(' ')} }`;
  const input = () => ({ i: { clinicId: w.kyiv, serviceId: w.c30 } });

  it('130 aliases of availability are refused, one (or a few) is fine', async () => {
    const heavy = await gql(f.api, avail(130), input());
    expect(codeOf(heavy)).toBe('QUERY_TOO_COMPLEX');
    expect(heavy.body.errors?.[0]?.message).toMatch(/expensive/);
    expect(avail(130).length).toBeLessThan(20_000); // a small request, not a body-size attack
    const one = await gql(f.api, avail(1), input());
    expect(one.body.errors).toBeUndefined();
    expect((await gql(f.api, avail(3), input())).body.errors).toBeUndefined();
  });

  it('a negative, absurd or junk limit never makes a list cheaper than the page it really returns', async () => {
    const schema = f.api.schemaRef.current!;
    const price = (q: string, v: Record<string, unknown> = {}) => estimateCost(schema, parse(q), v);
    const body = `id doctor { id } service { id }`;
    const one = price(`{ myAppointments(limit: 1) { ${body} } }`);
    expect(one).toBeGreaterThan(0);
    expect(price(`{ myAppointments(limit: -1000000) { ${body} } }`)).toBe(one); // executed as 1 row
    expect(price(`{ myAppointments(limit: 1000000000) { ${body} } }`)).toBe(
      price(`{ myAppointments(limit: 1000) { ${body} } }`),
    );
    expect(price(`query($l: Int){ myAppointments(limit: $l) { ${body} } }`, { l: -5 })).toBe(one);
    // no limit / null / a non-integer: priced as the default page (50), not as cheap
    const dflt = price(`{ myAppointments { ${body} } }`);
    expect(dflt).toBeGreaterThan(price(`{ myAppointments(limit: 10) { ${body} } }`));
    expect(price(`query($l: Int){ myAppointments(limit: $l) { ${body} } }`, { l: null })).toBe(
      dflt,
    );
    expect(price(`query($l: Int){ myAppointments(limit: $l) { ${body} } }`, { l: 1.5 })).toBe(dflt);
    expect(
      price(`query($l: Int){ myAppointments(limit: $l) { ${body} } }`, { l: Number.NaN }),
    ).toBe(dflt);
    // the old bug: a hostile negative limit drove the total down
    const base = `a: myAppointments(limit: 100) { ${body} }`;
    expect(price(`{ ${base} b: myAppointments(limit: -1000000) { ${body} } }`)).toBeGreaterThan(
      price(`{ ${base} }`),
    );
    // over HTTP: heavy list is refused, normal ones pass
    const p = await login(f.api, 'p0@t.io');
    const heavy = `query { myAppointments(limit: 100) { id doctor { id fullName specialty } clinic { id city timeZone } service { id nameUk nameEn namePl } patient { id fullName phone email visits { id doctor { id } } } events { type at actorRole reason } } }`;
    expect(codeOf(await gql(f.api, heavy, {}, { cookie: p }))).toBe('QUERY_TOO_COMPLEX');
    expect(
      (
        await gql(
          f.api,
          `query { myAppointments(limit: 5) { id doctor { id fullName } service { id nameUk } } }`,
          {},
          { cookie: p },
        )
      ).body.errors,
    ).toBeUndefined();
    expect(
      (
        await gql(
          f.api,
          `query { myAppointments { id } myWaitlist { id } myNotifications { id } clinics { id city } }`,
          {},
          { cookie: p },
        )
      ).body.errors,
    ).toBeUndefined();
  });

  it('one address has a per-minute cost budget; other addresses are untouched', async () => {
    const codes: (string | undefined)[] = [];
    for (let i = 0; i < 6; i++)
      codes.push(
        codeOf(
          await gql(
            budget.api,
            avail(1),
            { i: { clinicId: budget.w.kyiv, serviceId: budget.w.c30 } },
            { ip: '127.0.0.5' },
          ),
        ),
      );
    expect(codes.slice(0, 2)).toEqual([undefined, undefined]);
    expect(codes).toContain('RATE_LIMITED');
    const other = await gql(
      budget.api,
      avail(1),
      { i: { clinicId: budget.w.kyiv, serviceId: budget.w.c30 } },
      { ip: '127.0.0.6' },
    );
    expect(other.body.errors).toBeUndefined();
  });
});

describe('bad input is never INTERNAL_SERVER_ERROR (audit: MEDIUM)', () => {
  const NASTY = ['a\u0000b', '\u0000', 'x\u0001y', 'bad\ud800surrogate', '‮\u0000'];
  const DATES = [
    '0000-01-01',
    '9999-12-31',
    '0001-01-01',
    '1999-12-31',
    '2101-01-01',
    '2026-02-30',
    '-001-01-01',
    '+10000-01-01',
  ];

  const noInternal = (label: string, r: Awaited<ReturnType<typeof gql>>) => {
    expect(r.status, label).toBeLessThan(500);
    const code = codeOf(r);
    expect(code, `${label}: ${JSON.stringify(r.body.errors)}`).not.toBe('INTERNAL_SERVER_ERROR');
  };

  it('control characters in free text are rejected (sign-up, registrar booking, patient search)', async () => {
    const reg = await login(f.api, 'rk@t.io');
    let n = 0;
    for (const bad of NASTY) {
      const su = await gql(f.api, `mutation($i: SignUpInput!){ signUp(input:$i){ id } }`, {
        i: {
          email: `nul${n++}@t.io`,
          password: 'a-long-enough-pass',
          fullName: bad,
          phone: `+38050998${String(n).padStart(4, '0')}`,
        },
      });
      noInternal(`signUp ${JSON.stringify(bad)}`, su);
      expect(codeOf(su)).toBe('BAD_USER_INPUT');
      const rb = await gql(
        f.api,
        `mutation($i: RegistrarBookInput!){ registrarBook(input:$i){ id } }`,
        {
          i: {
            clinicId: w.kyiv,
            doctorId: w.kyivDoctors[0],
            serviceId: w.c30,
            startsAt: at(workday(30), '10:00').toISOString(),
            newPatientName: bad,
            newPatientPhone: '+380509977001',
            idempotencyKey: `nasty-key-${n}`,
          },
        },
        { cookie: reg },
      );
      noInternal(`registrarBook name ${JSON.stringify(bad)}`, rb);
      expect(codeOf(rb)).toBe('BAD_USER_INPUT');
      const rp = await gql(
        f.api,
        `mutation($i: RegistrarBookInput!){ registrarBook(input:$i){ id } }`,
        {
          i: {
            clinicId: w.kyiv,
            doctorId: w.kyivDoctors[0],
            serviceId: w.c30,
            startsAt: at(workday(30), '10:00').toISOString(),
            newPatientName: 'Fine Name',
            newPatientPhone: `+38050${bad}`,
            idempotencyKey: `nasty-key-p${n}`,
          },
        },
        { cookie: reg },
      );
      noInternal(`registrarBook phone ${JSON.stringify(bad)}`, rp);
      const sp = await gql(
        f.api,
        `query($q: String!){ searchPatients(query:$q){ id } }`,
        { q: `Pa${bad}` },
        { cookie: reg },
      );
      noInternal(`searchPatients ${JSON.stringify(bad)}`, sp);
      expect(sp.body.errors).toBeUndefined(); // an empty result, not an error
      expect(sp.body.data).toEqual({ searchPatients: [] });
    }
  });

  it('absurd calendar dates are validation errors on every date argument', async () => {
    const reg = await login(f.api, 'rk@t.io');
    const doc = await login(f.api, 'd0@t.io');
    const mgr = await (async () => {
      await f.t.db.execute(
        sql`INSERT INTO users (email, password_hash, role) SELECT 'mgr@t.io', password_hash, 'manager' FROM users LIMIT 1`,
      );
      return login(f.api, 'mgr@t.io');
    })();
    const pat = await login(f.api, 'p3@t.io');
    for (const d of DATES) {
      const calls: [string, Awaited<ReturnType<typeof gql>>][] = [
        [
          'availability',
          await gql(
            f.api,
            `query($i: AvailabilityInput!){ availability(input:$i){ durationMin slots { doctorId } } }`,
            { i: { clinicId: w.kyiv, serviceId: w.c30, fromDate: d } },
          ),
        ],
        [
          'clinicBoard',
          await gql(
            f.api,
            `query($c: ID!, $d: String!){ clinicBoard(clinicId:$c, date:$d){ id } }`,
            { c: w.kyiv, d },
            { cookie: reg },
          ),
        ],
        [
          'doctorSchedule',
          await gql(
            f.api,
            `query($d: String!){ doctorSchedule(fromDate:$d){ id } }`,
            { d },
            { cookie: doc },
          ),
        ],
        [
          'report from',
          await gql(
            f.api,
            `query($d: String!){ report(from:$d, to:$d){ from } }`,
            { d },
            { cookie: mgr },
          ),
        ],
        [
          'report to',
          await gql(
            f.api,
            `query($d: String!){ report(from:"2026-01-01", to:$d){ from } }`,
            { d },
            { cookie: mgr },
          ),
        ],
        [
          'joinWaitlist',
          await gql(
            f.api,
            `mutation($i: JoinWaitlistInput!){ joinWaitlist(input:$i){ id } }`,
            { i: { doctorId: w.kyivDoctors[0], serviceId: w.c30, fromDate: d, toDate: d } },
            { cookie: pat },
          ),
        ],
        [
          'markDoctorSick',
          await gql(
            f.api,
            `mutation($i: MarkSickInput!){ markDoctorSick(input:$i){ __typename } }`,
            { i: { doctorId: w.kyivDoctors[0], localDate: d } },
            { cookie: reg },
          ),
        ],
      ];
      for (const [name, r] of calls) {
        noInternal(`${name} ${d}`, r);
        expect(codeOf(r), `${name} ${d}`).toBe('BAD_USER_INPUT');
      }
    }
  });

  it('absurd instants are validation errors too', async () => {
    const pat = await login(f.api, 'p4@t.io');
    for (const s of [
      '0000-01-01T00:00:00Z',
      '9999-12-31T23:45:00Z',
      '+275760-09-13T00:00:00Z',
      '1000-01-01T00:00:00Z',
    ]) {
      const r = await gql(
        f.api,
        `mutation($i: HoldSlotInput!){ holdSlot(input:$i){ id } }`,
        { i: { clinicId: w.kyiv, doctorId: w.kyivDoctors[0], serviceId: w.c30, startsAt: s } },
        { cookie: pat },
      );
      noInternal(`holdSlot ${s}`, r);
    }
  });
});

describe('a revoked session stops receiving private events (audit: MEDIUM)', () => {
  it("signing out closes the patient's open socket and nothing is delivered afterwards", async () => {
    const cookie = await login(f.api, 'p20@t.io');
    const p = w.patients[20]!;
    const c = wsClient(f.api, { cookie });
    const sub = subscribe(c, `subscription { myAppointmentChanged { id } }`);
    await sleep(600);
    const mine = await insertPast(p.id, 0, '2025-05-10T09:00:00Z', 'booked');
    // sanity: before sign-out the subscriber does get its event
    await f.api.services.bus.publish({
      type: 'appointment',
      appointmentId: mine,
      patientId: p.id,
      clinicId: w.kyiv,
      doctorId: w.kyivDoctors[0]!,
    });
    expect(await waitUntil(() => sub.events.length >= 1)).toBe(true);
    const before = sub.events.length;
    const out = await gql(f.api, `mutation { signOut }`, {}, { cookie });
    expect(out.body.errors).toBeUndefined();
    expect(await waitUntil(() => sub.errors.length > 0, 5000)).toBe(true); // the socket was closed by the server
    await f.api.services.bus.publish({
      type: 'appointment',
      appointmentId: mine,
      patientId: p.id,
      clinicId: w.kyiv,
      doctorId: w.kyivDoctors[0]!,
    });
    await sleep(800);
    expect(sub.events.length).toBe(before);
    sub.dispose();
    await c.dispose();
  });

  it('a socket of another user from the same address is unaffected by someone else signing out', async () => {
    const c1 = await login(f.api, 'p21@t.io');
    const c2 = await login(f.api, 'p22@t.io');
    const p2 = w.patients[22]!;
    const ws = wsClient(f.api, { cookie: c2 });
    const sub = subscribe(ws, `subscription { myAppointmentChanged { id } }`);
    await sleep(600);
    await gql(f.api, `mutation { signOut }`, {}, { cookie: c1 });
    await sleep(600);
    expect(sub.errors).toEqual([]);
    const id = await insertPast(p2.id, 1, '2025-05-11T09:00:00Z', 'booked');
    await f.api.services.bus.publish({
      type: 'appointment',
      appointmentId: id,
      patientId: p2.id,
      clinicId: w.kyiv,
      doctorId: w.kyivDoctors[1]!,
    });
    expect(await waitUntil(() => sub.events.length >= 1)).toBe(true);
    sub.dispose();
    await ws.dispose();
  });
});
