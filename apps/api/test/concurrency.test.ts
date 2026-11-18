import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { at, codeOf, count, gql, login, sleep, startFixture, workday, type Fixture, type World } from './helpers.js';

let f: Fixture;
let w: World;
const ck: string[] = [];

beforeAll(async () => {
  f = await startFixture({ HOLD_TTL_SECONDS: '2', OFFER_TTL_SECONDS: '2' });
  w = f.w;
  for (let i = 0; i < 24; i++) ck.push(await login(f.api, `p${i}@t.io`));
});
afterAll(async () => { await f.stop(); });

const HOLD = `mutation($i: HoldSlotInput!){ holdSlot(input:$i){ id status holdExpiresAt } }`;
const CONFIRM = `mutation($i: ConfirmBookingInput!){ confirmBooking(input:$i){ id status } }`;
const slot = (doctor: number, day: number, time: string, svc = w.c30) => ({ clinicId: w.kyiv, doctorId: w.kyivDoctors[doctor], serviceId: svc, startsAt: at(workday(day), time).toISOString() });
const AV = `query($i: AvailabilityInput!){ availability(input:$i){ slots { doctorId startsAt } } }`;
const visible = async (doctor: number, day: number, time: string, svc = w.c30): Promise<boolean> => {
  const r = await gql<{ availability: { slots: { doctorId: string; startsAt: string }[] } }>(f.api, AV, { i: { clinicId: w.kyiv, serviceId: svc, doctorId: w.kyivDoctors[doctor], fromDate: workday(day) } });
  const t = at(workday(day), time).getTime();
  return !!r.body.data?.availability.slots.some((s) => s.doctorId === w.kyivDoctors[doctor] && new Date(s.startsAt).getTime() === t);
};

describe('clients send explicit nulls for optional fields (as the web app does)', () => {
  it('availability accepts doctorId: null and fromDate: null', async () => {
    const r = await gql<{ availability: { slots: unknown[] } }>(f.api, `query($i: AvailabilityInput!){ availability(input:$i){ slots { startsAt } } }`, { i: { clinicId: w.kyiv, serviceId: w.c30, doctorId: null, fromDate: null } });
    expect(r.body.errors).toBeUndefined();
    expect(r.body.data?.availability.slots.length).toBeGreaterThan(0);
  });
  it('the doctor list accepts serviceId: null', async () => {
    const r = await gql<{ clinicDoctors: unknown[] }>(f.api, `query($c: ID!, $s: ID){ clinicDoctors(clinicId:$c, serviceId:$s){ id } }`, { c: w.kyiv, s: null });
    expect(r.body.errors).toBeUndefined();
    expect(r.body.data?.clinicDoctors.length).toBeGreaterThan(0);
  });
});

describe('invariants through real HTTP (acceptance 4, 5)', () => {
  it('20 patients race for one time: one reservation, 19 clear refusals, no 500s', async () => {
    const rs = await Promise.all(ck.slice(0, 20).map((cookie) => gql(f.api, HOLD, { i: slot(0, 2, '10:00') }, { cookie })));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(rs.filter((r) => !r.body.errors)).toHaveLength(1);
    const codes = rs.filter((r) => r.body.errors).map(codeOf);
    expect(codes).toHaveLength(19);
    expect(codes.every((c) => c === 'SLOT_TAKEN')).toBe(true);
    expect(await count(f.t.db, sql`SELECT count(*)::int AS n FROM appointments WHERE doctor_id = ${w.kyivDoctors[0]}::uuid AND status = 'held'`)).toBe(1);
  });

  it('two doctors, one ultrasound room, same time: one passes', async () => {
    const rs = await Promise.all([0, 1, 2, 3].map((d) => gql(f.api, HOLD, { i: slot(d + 1, 3, '11:00', w.u30) }, { cookie: ck[d + 20] })));
    expect(rs.filter((r) => !r.body.errors)).toHaveLength(1);
    for (const r of rs.filter((x) => x.body.errors)) expect(['ROOM_TAKEN', 'SLOT_TAKEN']).toContain(codeOf(r));
  });

  it('confirm is idempotent: 12 simultaneous retries with one key give one booking', async () => {
    const h = await gql<{ holdSlot: { id: string } }>(f.api, HOLD, { i: slot(2, 4, '10:00') }, { cookie: ck[20] });
    const id = h.body.data?.holdSlot.id as string;
    const rs = await Promise.all(Array.from({ length: 12 }, () => gql<{ confirmBooking: { id: string; status: string } }>(f.api, CONFIRM, { i: { appointmentId: id, idempotencyKey: 'http-idem-0001' } }, { cookie: ck[20] })));
    expect(rs.every((r) => !r.body.errors)).toBe(true);
    expect(new Set(rs.map((r) => r.body.data?.confirmBooking.id)).size).toBe(1);
    expect(rs[0]?.body.data?.confirmBooking.status).toBe('booked');
    expect(await count(f.t.db, sql`SELECT count(*)::int AS n FROM appointment_events WHERE appointment_id = ${id}::uuid AND type = 'confirmed'`)).toBe(1);
  });
});

describe('the hold lasts 10 minutes (here 2 s) (acceptance 6)', () => {
  it('a late confirm is refused, the time is free again and the next person can take it', async () => {
    const r = slot(3, 5, '10:00');
    const h = await gql<{ holdSlot: { id: string } }>(f.api, HOLD, { i: r }, { cookie: ck[0] });
    const id = h.body.data?.holdSlot.id as string;
    expect(await visible(3, 5, '10:00')).toBe(false);
    await sleep(2300);
    expect(await visible(3, 5, '10:00')).toBe(true); // visible again, no worker involved
    const late = await gql(f.api, CONFIRM, { i: { appointmentId: id, idempotencyKey: 'http-late-0001' } }, { cookie: ck[0] });
    expect(codeOf(late)).toBe('HOLD_EXPIRED');
    const next = await gql(f.api, HOLD, { i: r }, { cookie: ck[1] });
    expect(next.body.errors).toBeUndefined();
    expect(await visible(3, 5, '10:00')).toBe(false);
  });
});

describe('reschedule and waiting list over HTTP (acceptance 7, 8)', () => {
  const RESCHEDULE = `mutation($i: RescheduleInput!){ rescheduleAppointment(input:$i){ id startsAt version } }`;
  const book = async (who: number, s: ReturnType<typeof slot>) => {
    const h = await gql<{ holdSlot: { id: string } }>(f.api, HOLD, { i: s }, { cookie: ck[who] });
    const id = h.body.data?.holdSlot.id as string;
    expect((await gql(f.api, CONFIRM, { i: { appointmentId: id, idempotencyKey: `book-${id}` } }, { cookie: ck[who] })).body.errors).toBeUndefined();
    return id;
  };

  it('moving onto a time that was just taken fails and the old visit stays', async () => {
    const mine = await book(5, slot(4, 6, '10:00'));
    await book(6, slot(4, 7, '10:00'));
    const r = await gql(f.api, RESCHEDULE, { i: { appointmentId: mine, newStartsAt: at(workday(7), '10:00').toISOString() } }, { cookie: ck[5] });
    expect(codeOf(r)).toBe('SLOT_TAKEN');
    const row = (await f.t.db.execute(sql`SELECT status, starts_at, version FROM appointments WHERE id = ${mine}::uuid`)).rows[0] as { status: string; version: number; starts_at: string };
    expect(row.status).toBe('booked');
    expect(row.version).toBe(1);
    expect(new Date(row.starts_at).getTime()).toBe(at(workday(6), '10:00').getTime());
  });

  it('two patients move into the same time at once: one wins', async () => {
    const a = await book(7, slot(5, 8, '10:00'));
    const b = await book(8, slot(5, 9, '10:00'));
    const target = at(workday(10), '10:00').toISOString();
    const [ra, rb] = await Promise.all([
      gql(f.api, RESCHEDULE, { i: { appointmentId: a, newStartsAt: target } }, { cookie: ck[7] }),
      gql(f.api, RESCHEDULE, { i: { appointmentId: b, newStartsAt: target } }, { cookie: ck[8] }),
    ]);
    expect([ra, rb].filter((r) => !r.body.errors)).toHaveLength(1);
    expect(await count(f.t.db, sql`SELECT count(*)::int AS n FROM appointments WHERE doctor_id = ${w.kyivDoctors[5]}::uuid AND status = 'booked'`)).toBe(2);
  });

  it('cancel with a waiting list: the first in the queue gets the offer, nobody sees the time, they accept', async () => {
    const id = await book(9, slot(0, 12, '10:00'));
    const join = (who: number) => gql(f.api, `mutation($i: JoinWaitlistInput!){ joinWaitlist(input:$i){ id } }`, { i: { doctorId: w.kyivDoctors[0], serviceId: w.c30, fromDate: workday(12), toDate: workday(14) } }, { cookie: ck[who] });
    expect((await join(10)).body.errors).toBeUndefined();
    await sleep(30);
    expect((await join(11)).body.errors).toBeUndefined();
    expect((await gql(f.api, `mutation($i: CancelInput!){ cancelAppointment(input:$i){ status } }`, { i: { appointmentId: id } }, { cookie: ck[9] })).body.errors).toBeUndefined();
    expect(await visible(0, 12, '10:00')).toBe(false);
    const offers = await gql<{ myOffers: { id: string; expiresAt: string; appointment: { startsAt: string } | null }[] }>(f.api, `{ myOffers { id expiresAt appointment { startsAt } } }`, {}, { cookie: ck[10] });
    expect(offers.body.data?.myOffers).toHaveLength(1);
    expect((await gql<{ myOffers: unknown[] }>(f.api, `{ myOffers { id } }`, {}, { cookie: ck[11] })).body.data?.myOffers).toHaveLength(0); // the second sees nothing yet
    expect(codeOf(await gql(f.api, HOLD, { i: slot(0, 12, '10:00') }, { cookie: ck[12] }))).toBe('SLOT_TAKEN');
    const oid = offers.body.data?.myOffers[0]?.id as string;
    expect((await gql(f.api, `mutation($i: RespondOfferInput!){ acceptOffer(input:$i){ status } }`, { i: { offerId: oid } }, { cookie: ck[11] })).body.errors?.[0]?.extensions?.code).toBe('NOT_FOUND');
    const acc = await gql<{ acceptOffer: { status: string } }>(f.api, `mutation($i: RespondOfferInput!){ acceptOffer(input:$i){ status } }`, { i: { offerId: oid } }, { cookie: ck[10] });
    expect(acc.body.data?.acceptOffer.status).toBe('booked');
  });
});
