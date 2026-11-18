import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { at, codeOf, gql, login, sleep, startFixture, subscribe, waitUntil, wsClient, workday, type Fixture, type World } from './helpers.js';

let f: Fixture;
let w: World;
const ck: Record<string, string> = {};

beforeAll(async () => {
  f = await startFixture({ WS_MAX_CONN_PER_IP: '6', WS_MAX_SUBS_PER_CONN: '3' });
  w = f.w;
  for (const [k, email] of Object.entries({ p0: 'p0@t.io', p1: 'p1@t.io', p2: 'p2@t.io', rk: 'rk@t.io', rw: 'rw@t.io', d0: 'd0@t.io', d1: 'd1@t.io' })) ck[k] = await login(f.api, email);
});
afterAll(async () => { await f.stop(); });

const HOLD = `mutation($i: HoldSlotInput!){ holdSlot(input:$i){ id } }`;
const CONFIRM = `mutation($i: ConfirmBookingInput!){ confirmBooking(input:$i){ id } }`;
const book = async (who: string, doctor: number, day: number, time: string) => {
  const h = await gql<{ holdSlot: { id: string } }>(f.api, HOLD, { i: { clinicId: w.kyiv, doctorId: w.kyivDoctors[doctor], serviceId: w.c30, startsAt: at(workday(day), time).toISOString() } }, { cookie: ck[who] });
  const id = h.body.data?.holdSlot.id as string;
  await gql(f.api, CONFIRM, { i: { appointmentId: id, idempotencyKey: `ws-${id}` } }, { cookie: ck[who] });
  return id;
};

describe('the free-time grid updates by itself (acceptance 3)', () => {
  it('a second viewer sees a booked time disappear and a released one come back, without reloading', async () => {
    const watcher = wsClient(f.api); // anonymous browser, never signed in
    const sub = subscribe(watcher, `subscription($c: ID!){ availabilityChanged(clinicId:$c){ clinicId doctorId localDate } }`, { c: w.kyiv });
    await sleep(500);
    const id = await book('p0', 0, 20, '10:00');
    expect(await waitUntil(() => sub.events.length >= 2)).toBe(true); // hold + confirm
    expect(sub.events[0]).toMatchObject({ availabilityChanged: { clinicId: w.kyiv, doctorId: w.kyivDoctors[0], localDate: workday(20) } });
    const n = sub.events.length;
    await gql(f.api, `mutation($i: CancelInput!){ cancelAppointment(input:$i){ id } }`, { i: { appointmentId: id } }, { cookie: ck['p0'] });
    expect(await waitUntil(() => sub.events.length > n)).toBe(true);
    // the payload is a pointer only: no personal data in it
    expect(JSON.stringify(sub.events)).not.toMatch(/Patient|phone|email|p0@/);
    sub.dispose();
    await watcher.dispose();
  });

  it('only events of the clinic and doctor asked for arrive', async () => {
    const watcher = wsClient(f.api);
    const sub = subscribe(watcher, `subscription($c: ID!, $d: ID){ availabilityChanged(clinicId:$c, doctorId:$d){ doctorId } }`, { c: w.kyiv, d: w.kyivDoctors[5] });
    await sleep(500);
    await book('p1', 1, 21, '10:00'); // another doctor
    await sleep(1200);
    expect(sub.events).toEqual([]);
    await book('p1', 5, 22, '10:00');
    expect(await waitUntil(() => sub.events.length >= 1)).toBe(true);
    sub.dispose();
    await watcher.dispose();
  });
});

describe('private subscriptions never leak (invariant 13)', () => {
  const MINE = `subscription { myAppointmentChanged { id patientId patient { fullName phone } } }`;
  it('patient B gets nothing while A books; A gets A\'s own', async () => {
    const a = wsClient(f.api, { cookie: ck['p0'] });
    const b = wsClient(f.api, { cookie: ck['p1'] });
    const subA = subscribe(a, MINE);
    const subB = subscribe(b, MINE);
    await sleep(600);
    const id = await book('p0', 2, 23, '10:00');
    expect(await waitUntil(() => subA.events.length >= 1)).toBe(true);
    await sleep(1000);
    expect(subB.events).toEqual([]);
    expect(JSON.stringify(subA.events)).toContain(id);
    expect(JSON.stringify(subA.events)).toContain(w.patients[0]!.id);
    subA.dispose(); subB.dispose();
    await a.dispose(); await b.dispose();
  });

  it('anonymous visitors cannot open private subscriptions', async () => {
    const c = wsClient(f.api);
    const s = subscribe(c, MINE);
    await s.done;
    expect(JSON.stringify(s.errors)).toMatch(/UNAUTHENTICATED/);
    expect(s.events).toEqual([]);
    await c.dispose();
  });

  it('a Warsaw registrar cannot listen to the Kyiv board; the Kyiv one can, and sees only Kyiv', async () => {
    const q = `subscription($c: ID!){ clinicAppointmentChanged(clinicId:$c){ id clinicId patient { phone } } }`;
    const bad = subscribe(wsClient(f.api, { cookie: ck['rw'] }), q, { c: w.kyiv });
    await bad.done;
    expect(JSON.stringify(bad.errors)).toMatch(/FORBIDDEN/);
    expect(bad.events).toEqual([]);

    const kc = wsClient(f.api, { cookie: ck['rk'] });
    const good = subscribe(kc, q, { c: w.kyiv });
    const wc = wsClient(f.api, { cookie: ck['rw'] });
    const own = subscribe(wc, q, { c: w.warsaw });
    await sleep(600);
    const id = await book('p2', 3, 24, '10:00');
    expect(await waitUntil(() => good.events.length >= 1)).toBe(true);
    await sleep(800);
    expect(own.events).toEqual([]); // the Warsaw board heard nothing about Kyiv
    expect(JSON.stringify(good.events)).toContain(id);
    good.dispose(); own.dispose();
    await kc.dispose(); await wc.dispose();
  });

  it('patients and doctors cannot open the registrar board; a doctor hears only their own visits', async () => {
    const q = `subscription($c: ID!){ clinicAppointmentChanged(clinicId:$c){ id } }`;
    for (const who of ['p0', 'd0']) {
      const s = subscribe(wsClient(f.api, { cookie: ck[who] }), q, { c: w.kyiv });
      await s.done;
      expect(JSON.stringify(s.errors), who).toMatch(/FORBIDDEN/);
    }
    const d0 = wsClient(f.api, { cookie: ck['d0'] });
    const d1 = wsClient(f.api, { cookie: ck['d1'] });
    const D = `subscription { doctorAppointmentChanged { id doctorId patient { fullName phone } } }`;
    const s0 = subscribe(d0, D);
    const s1 = subscribe(d1, D);
    await sleep(600);
    const id = await book('p1', 0, 25, '10:00'); // doctor 0's patient
    expect(await waitUntil(() => s0.events.length >= 1)).toBe(true);
    await sleep(800);
    expect(s1.events).toEqual([]);
    expect(JSON.stringify(s0.events)).toContain(id);
    expect(JSON.stringify(s0.events)).not.toContain('+3805'); // a doctor gets the name, never the phone
    s0.dispose(); s1.dispose();
    await d0.dispose(); await d1.dispose();
  });

  it('an event for a visit the subscriber may not see yields nothing even if the filter were bypassed (resolver re-checks)', async () => {
    const c = wsClient(f.api, { cookie: ck['p1'] });
    const s = subscribe(c, `subscription { myAppointmentChanged { id } }`);
    await sleep(500);
    // inject an event that claims to be p1's but points at p0's visit
    const other = await f.t.db.execute(sql`SELECT id FROM appointments WHERE patient_id = ${w.patients[0]!.id}::uuid LIMIT 1`);
    const aid = (other.rows[0] as { id: string }).id;
    await f.api.services.bus.publish({ type: 'appointment', appointmentId: aid, patientId: w.patients[1]!.id, clinicId: w.kyiv, doctorId: w.kyivDoctors[0]! });
    await sleep(1000);
    expect(s.events.every((e) => (e as { myAppointmentChanged: unknown }).myAppointmentChanged === null)).toBe(true);
    s.dispose();
    await c.dispose();
  });
});

describe('subscriptions are not a way around the limits', () => {
  it('too many sockets from one address are refused', async () => {
    const subs: ReturnType<typeof subscribe>[] = [];
    const clients = Array.from({ length: 9 }, () => wsClient(f.api));
    for (const c of clients) subs.push(subscribe(c, `subscription($c: ID!){ availabilityChanged(clinicId:$c){ doctorId } }`, { c: w.kyiv }));
    await sleep(1500);
    const refused = subs.filter((s) => s.errors.length > 0).length;
    expect(refused).toBeGreaterThanOrEqual(3);
    expect(subs.length - refused).toBeLessThanOrEqual(6);
    subs.forEach((s) => s.dispose());
    await Promise.all(clients.map((c) => c.dispose()));
    await sleep(500);
    // after they closed, capacity is back
    const again = wsClient(f.api);
    const s = subscribe(again, `subscription($c: ID!){ availabilityChanged(clinicId:$c){ doctorId } }`, { c: w.kyiv });
    await sleep(600);
    expect(s.errors).toEqual([]);
    s.dispose();
    await again.dispose();
  });

  it('a connection may hold only a few subscriptions', async () => {
    const c = wsClient(f.api);
    const subs = Array.from({ length: 6 }, () => subscribe(c, `subscription($c: ID!){ availabilityChanged(clinicId:$c){ doctorId } }`, { c: w.kyiv }));
    await sleep(1200);
    expect(subs.filter((s) => s.errors.length > 0).length).toBeGreaterThanOrEqual(3);
    subs.forEach((s) => s.dispose());
    await c.dispose();
  });

  it('a subscription with a selection deeper than the limit is refused like a query', async () => {
    const c = wsClient(f.api, { cookie: ck['p0'] });
    const nest = (n: number): string => (n === 0 ? 'id' : `patient { visits { ${nest(n - 1)} } }`);
    const shallow = subscribe(c, `subscription { myAppointmentChanged { ${nest(1)} } }`);
    await sleep(500);
    expect(shallow.errors).toEqual([]);
    shallow.dispose();
    const deep = subscribe(c, `subscription { myAppointmentChanged { ${nest(8)} } }`);
    await deep.done;
    expect(JSON.stringify(deep.errors)).toMatch(/QUERY_TOO_COMPLEX|too deep/);
    await c.dispose();
  });

  it('reconnect storms and subscribe floods from one address are rate limited, others are not', async () => {
    const lim = await startFixture({ RATE_WS_CONNECT_PER_MIN: '5', RATE_WS_SUBSCRIBE_PER_MIN: '8', WS_MAX_SUBS_PER_CONN: '100', WS_MAX_CONN_PER_IP: '100' });
    try {
      const q = `subscription($c: ID!){ availabilityChanged(clinicId:$c){ doctorId } }`;
      // 12 connections in a minute from the attacker: only 5 get through
      const results: boolean[] = [];
      for (let i = 0; i < 12; i++) {
        const c = wsClient(lim.api, { ip: '127.0.0.2' });
        const s = subscribe(c, q, { c: lim.w.kyiv });
        await sleep(150);
        results.push(s.errors.length === 0);
        s.dispose();
        await c.dispose();
      }
      expect(results.filter(Boolean).length).toBeLessThanOrEqual(5);
      // a neighbour is unaffected
      const other = wsClient(lim.api, { ip: '127.0.0.3' });
      const ok = subscribe(other, q, { c: lim.w.kyiv });
      await sleep(400);
      expect(ok.errors).toEqual([]);
      ok.dispose();
      await other.dispose();
      // one connection spamming subscribe messages is cut off by the subscribe budget
      const spam = wsClient(lim.api, { ip: '127.0.0.4' });
      const subs = Array.from({ length: 14 }, () => subscribe(spam, q, { c: lim.w.kyiv }));
      await sleep(1500);
      expect(subs.filter((x) => JSON.stringify(x.errors).includes('RATE_LIMITED')).length).toBeGreaterThanOrEqual(5);
      subs.forEach((x) => x.dispose());
      await spam.dispose();
    } finally {
      await lim.stop();
    }
  });

  it('errors from a wrong role never carry data', async () => {
    const r = await gql(f.api, `query { myAppointments { id } }`, {}, { cookie: ck['rk'] });
    expect(codeOf(r)).toBe('FORBIDDEN');
    expect(r.body.data ?? null).toBeNull();
  });
});
