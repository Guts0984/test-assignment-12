import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { confirmBooking, holdSlot, type Actor } from '@clinic/domain';
import { PUBLIC_KEY, ROLES_KEY } from '../src/auth/roles.js';
import { RESOLVERS } from '../src/module.js';
import {
  at,
  codeOf,
  count,
  gql,
  login,
  makeCtx,
  must,
  rows,
  startFixture,
  workday,
  type Fixture,
  type World,
} from './helpers.js';

let f: Fixture;
let w: World;
const cookies: Record<string, string> = {};
const realClock = {
  get now(): Date {
    return new Date();
  },
} as { now: Date };

// a visit of patient 0 with Kyiv doctor 0, one of patient 1 with doctor 1, one Warsaw visit of patient 2
let a0 = '';
let a1 = '';
let aW = '';
let held0 = '';

const book = async (
  actor: Actor,
  clinic: string,
  doctor: string,
  svc: string,
  day: number,
  time: string,
  tz = 'Europe/Kyiv',
) => {
  const ctx = makeCtx(f.t.db, realClock);
  const h = must(
    await holdSlot(ctx, actor, {
      clinicId: clinic,
      doctorId: doctor,
      serviceId: svc,
      startsAt: at(workday(day), time, tz),
    }),
  );
  return must(
    await confirmBooking(ctx, actor, { appointmentId: h.id, idempotencyKey: `auth-${h.id}` }),
  );
};

beforeAll(async () => {
  f = await startFixture();
  w = f.w;
  a0 = (await book(w.patients[0]!.actor, w.kyiv, w.kyivDoctors[0]!, w.c30, 25, '10:00')).id;
  a1 = (await book(w.patients[1]!.actor, w.kyiv, w.kyivDoctors[1]!, w.c30, 25, '10:00')).id;
  aW = (
    await book(w.patients[2]!.actor, w.warsaw, w.warsawDoctor, w.c30, 25, '10:00', 'Europe/Warsaw')
  ).id;
  const h = must(
    await holdSlot(makeCtx(f.t.db, realClock), w.patients[3]!.actor, {
      clinicId: w.kyiv,
      doctorId: w.kyivDoctors[2]!,
      serviceId: w.c30,
      startsAt: at(workday(26), '10:00'),
    }),
  );
  held0 = h.id;
  for (const [k, email] of Object.entries({
    p0: 'p0@t.io',
    p1: 'p1@t.io',
    p2: 'p2@t.io',
    p3: 'p3@t.io',
    rk: 'rk@t.io',
    rw: 'rw@t.io',
    d0: 'd0@t.io',
    d1: 'd1@t.io',
  }))
    cookies[k] = await login(f.api, email);
  await f.t.db.execute(
    sql`INSERT INTO users (email, password_hash, role) SELECT 'm@t.io', password_hash, 'manager' FROM users LIMIT 1`,
  );
  cookies['m'] = await login(f.api, 'm@t.io');
});
afterAll(async () => {
  await f.stop();
});

const APPT = `id status patientId doctorId clinicId patient { id fullName phone email } events { type actorRole }`;
const GET = `query($id: ID!){ appointment(id:$id){ ${APPT} } }`;
const state = async (id: string) =>
  (
    await rows(
      f.t.db,
      sql`SELECT status, version, starts_at FROM appointments WHERE id = ${id}::uuid`,
    )
  )[0];

describe('default deny', () => {
  it('every query, mutation and subscription declares who may call it', () => {
    const missing: string[] = [];
    for (const R of RESOLVERS) {
      for (const name of Object.getOwnPropertyNames(R.prototype)) {
        const fn = (R.prototype as unknown as Record<string, unknown>)[name];
        if (typeof fn !== 'function' || name === 'constructor') continue;
        const type = Reflect.getMetadata('graphql:resolver_type', fn as object) as
          string | undefined;
        if (type !== 'Query' && type !== 'Mutation' && type !== 'Subscription') continue;
        const pub = Reflect.getMetadata(PUBLIC_KEY, fn as object);
        const roles = Reflect.getMetadata(ROLES_KEY, fn as object);
        if (pub === undefined && roles === undefined) missing.push(`${R.name}.${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('anonymous visitors get UNAUTHENTICATED on everything private', async () => {
    const calls: [string, Record<string, unknown>][] = [
      [`{ myAppointments { id } }`, {}],
      [`{ myWaitlist { id } }`, {}],
      [`{ myOffers { id } }`, {}],
      [`{ myNotifications { id } }`, {}],
      [`query{ appointment(id:"${a0}"){ id } }`, {}],
      [`query{ clinicBoard(clinicId:"${w.kyiv}", date:"2026-06-10"){ id } }`, {}],
      [`query{ doctorSchedule(fromDate:"2026-06-10"){ id } }`, {}],
      [`query{ searchPatients(query:"Pa"){ id } }`, {}],
      [`query{ report(from:"2026-06-01", to:"2026-06-30"){ from } }`, {}],
      [`mutation{ cancelAppointment(input:{appointmentId:"${a0}"}){ id } }`, {}],
      [
        `mutation{ holdSlot(input:{clinicId:"${w.kyiv}", doctorId:"${w.kyivDoctors[0]}", serviceId:"${w.c30}", startsAt:"2026-06-10T07:00:00Z"}){ id } }`,
        {},
      ],
      [
        `mutation{ markDoctorSick(input:{doctorId:"${w.kyivDoctors[0]}", localDate:"2026-06-10"}){ cancelled } }`,
        {},
      ],
      [`mutation{ checkIn(id:"${a0}"){ id } }`, {}],
      [`mutation{ markNotificationsRead }`, {}],
    ];
    for (const [q] of calls)
      expect(codeOf(await gql(f.api, q)), q.slice(0, 60)).toBe('UNAUTHENTICATED');
  });
});

describe('patients see and change only their own visits', () => {
  it('B cannot read, cancel, move or confirm what belongs to A — and nothing changes', async () => {
    const before = [await state(a0), await state(held0)];
    const b = { cookie: cookies['p1'] };
    const r = await gql<{ appointment: unknown }>(f.api, GET, { id: a0 }, b);
    expect(r.body.data?.appointment).toBeNull();
    expect(
      codeOf(
        await gql(
          f.api,
          `mutation($i: CancelInput!){ cancelAppointment(input:$i){ id } }`,
          { i: { appointmentId: a0 } },
          b,
        ),
      ),
    ).toBe('NOT_FOUND');
    expect(
      codeOf(
        await gql(
          f.api,
          `mutation($i: RescheduleInput!){ rescheduleAppointment(input:$i){ id } }`,
          { i: { appointmentId: a0, newStartsAt: at(workday(27), '11:00').toISOString() } },
          b,
        ),
      ),
    ).toBe('NOT_FOUND');
    expect(
      codeOf(
        await gql(
          f.api,
          `mutation($i: ConfirmBookingInput!){ confirmBooking(input:$i){ id } }`,
          { i: { appointmentId: held0, idempotencyKey: 'steal-1234' } },
          b,
        ),
      ),
    ).toBe('NOT_FOUND');
    expect([await state(a0), await state(held0)]).toEqual(before);
  });

  it('my lists contain only mine', async () => {
    const r = await gql<{ myAppointments: { id: string; patientId: string }[] }>(
      f.api,
      `{ myAppointments { id patientId } }`,
      {},
      { cookie: cookies['p0'] },
    );
    expect(r.body.data?.myAppointments.map((x) => x.id)).toEqual([a0]);
    const r2 = await gql<{ myAppointments: { id: string }[] }>(
      f.api,
      `{ myAppointments { id } }`,
      {},
      { cookie: cookies['p2'] },
    );
    expect(r2.body.data?.myAppointments.map((x) => x.id)).toEqual([aW]);
  });

  it("a patient sees their own contacts and history, never someone else's", async () => {
    const r = await gql<{
      appointment: { patient: { phone: string; email: string }; events: { type: string }[] };
    }>(f.api, GET, { id: a0 }, { cookie: cookies['p0'] });
    expect(r.body.data?.appointment.patient.phone).toBe('+380500000000');
    expect(r.body.data?.appointment.events.map((e) => e.type)).toEqual(['held', 'confirmed']);
  });

  it("patientId in the input is ignored for patients (no booking on someone else's behalf)", async () => {
    const q = `mutation($i: HoldSlotInput!){ holdSlot(input:$i){ id patientId } }`;
    const r = await gql<{ holdSlot: { patientId: string } }>(
      f.api,
      q,
      {
        i: {
          clinicId: w.kyiv,
          doctorId: w.kyivDoctors[3],
          serviceId: w.c30,
          startsAt: at(workday(27), '10:00').toISOString(),
          patientId: w.patients[7]!.id,
        },
      },
      { cookie: cookies['p3'] },
    );
    expect(r.body.data?.holdSlot.patientId).toBe(w.patients[3]!.id);
  });

  it('unknown input fields are rejected by the schema (no mass assignment)', async () => {
    const r = await gql(
      f.api,
      `mutation($i: HoldSlotInput!){ holdSlot(input:$i){ id } }`,
      {
        i: {
          clinicId: w.kyiv,
          doctorId: w.kyivDoctors[3],
          serviceId: w.c30,
          startsAt: at(workday(28), '10:00').toISOString(),
          status: 'booked',
          priceMinor: 1,
        },
      },
      { cookie: cookies['p3'] },
    );
    expect(r.body.errors).toBeDefined();
    expect(codeOf(r)).not.toBe('INTERNAL_SERVER_ERROR');
  });

  it('patients cannot use staff operations', async () => {
    const p = { cookie: cookies['p0'] };
    const attempts = [
      `query{ clinicBoard(clinicId:"${w.kyiv}", date:"2026-06-10"){ id } }`,
      `query{ doctorSchedule(fromDate:"2026-06-10"){ id } }`,
      `query{ searchPatients(query:"Pa"){ id } }`,
      `query{ report(from:"2026-06-01", to:"2026-06-30"){ from } }`,
      `query{ doctorWeeklySchedule(doctorId:"${w.kyivDoctors[0]}"){ doctorId } }`,
      `mutation{ checkIn(id:"${a0}"){ id } }`,
      `mutation{ markNoShow(id:"${a0}"){ id } }`,
      `mutation{ completeVisit(id:"${a0}"){ id } }`,
      `mutation{ markDoctorSick(input:{doctorId:"${w.kyivDoctors[0]}", localDate:"2026-06-10"}){ cancelled } }`,
      `mutation{ setScheduleTemplate(input:{doctorId:"${w.kyivDoctors[0]}", clinicId:"${w.kyiv}", weekday:1, startLocal:"09:00", endLocal:"12:00"}) }`,
      `mutation{ setScheduleException(input:{doctorId:"${w.kyivDoctors[0]}", localDate:"2026-06-10", kind: vacation}) }`,
      `mutation{ registrarBook(input:{clinicId:"${w.kyiv}", doctorId:"${w.kyivDoctors[0]}", serviceId:"${w.c30}", startsAt:"2026-06-10T07:00:00Z", patientId:"${w.patients[0]!.id}", idempotencyKey:"abcdefgh"}){ id } }`,
    ];
    for (const q of attempts)
      expect(codeOf(await gql(f.api, q, {}, p)), q.slice(0, 50)).toBe('FORBIDDEN');
    expect((await state(a0))?.['status']).toBe('booked');
  });
});

describe('a registrar sees and changes only their own clinic', () => {
  const w_ = () => ({ cookie: cookies['rw'] });
  it('Warsaw registrar vs a Kyiv visit: not found / forbidden, no change', async () => {
    const before = await state(a0);
    expect(
      (await gql<{ appointment: unknown }>(f.api, GET, { id: a0 }, w_())).body.data?.appointment,
    ).toBeNull();
    expect(
      codeOf(
        await gql(
          f.api,
          `query{ clinicBoard(clinicId:"${w.kyiv}", date:"${workday(25)}"){ id } }`,
          {},
          w_(),
        ),
      ),
    ).toBe('FORBIDDEN');
    expect(codeOf(await gql(f.api, `mutation{ checkIn(id:"${a0}"){ id } }`, {}, w_()))).toBe(
      'NOT_FOUND',
    );
    expect(codeOf(await gql(f.api, `mutation{ markNoShow(id:"${a0}"){ id } }`, {}, w_()))).toBe(
      'NOT_FOUND',
    );
    expect(
      codeOf(
        await gql(
          f.api,
          `mutation{ cancelAppointment(input:{appointmentId:"${a0}"}){ id } }`,
          {},
          w_(),
        ),
      ),
    ).toBe('NOT_FOUND');
    expect(
      codeOf(
        await gql(
          f.api,
          `mutation{ markDoctorSick(input:{doctorId:"${w.kyivDoctors[0]}", localDate:"${workday(25)}"}){ cancelled } }`,
          {},
          w_(),
        ),
      ),
    ).toBe('NOT_FOUND');
    expect(
      codeOf(
        await gql(
          f.api,
          `mutation{ setScheduleTemplate(input:{doctorId:"${w.kyivDoctors[0]}", clinicId:"${w.kyiv}", weekday:3, startLocal:"09:00", endLocal:"10:00"}) }`,
          {},
          w_(),
        ),
      ),
    ).toBe('FORBIDDEN');
    expect(
      codeOf(
        await gql(
          f.api,
          `query{ doctorWeeklySchedule(doctorId:"${w.kyivDoctors[0]}"){ doctorId } }`,
          {},
          w_(),
        ),
      ),
    ).toBe('NOT_FOUND');
    expect(
      codeOf(
        await gql(
          f.api,
          `mutation{ registrarBook(input:{clinicId:"${w.kyiv}", doctorId:"${w.kyivDoctors[0]}", serviceId:"${w.c30}", startsAt:"${at(workday(29), '10:00').toISOString()}", patientId:"${w.patients[9]!.id}", idempotencyKey:"abcdefgh1"}){ id } }`,
          {},
          w_(),
        ),
      ),
    ).toBe('NOT_FOUND');
    expect(await state(a0)).toEqual(before);
    expect(await count(f.t.db, sql`SELECT count(*)::int AS n FROM schedule_exceptions`)).toBe(0);
  });

  it('own clinic works: board lists only its visits, with contacts', async () => {
    const r = await gql<{
      clinicBoard: { id: string; clinicId: string; patient: { phone: string } }[];
    }>(
      f.api,
      `query($c: ID!, $d: String!){ clinicBoard(clinicId:$c, date:$d){ id clinicId patient { phone } } }`,
      { c: w.kyiv, d: workday(25) },
      { cookie: cookies['rk'] },
    );
    expect(r.body.errors).toBeUndefined();
    expect(r.body.data?.clinicBoard.map((x) => x.id).sort()).toEqual([a0, a1].sort());
    expect(r.body.data?.clinicBoard.every((x) => x.clinicId === w.kyiv && x.patient.phone)).toBe(
      true,
    );
    const wr = await gql<{ clinicBoard: { id: string }[] }>(
      f.api,
      `query($c: ID!, $d: String!){ clinicBoard(clinicId:$c, date:$d){ id } }`,
      { c: w.warsaw, d: workday(25) },
      w_(),
    );
    expect(wr.body.data?.clinicBoard.map((x) => x.id)).toEqual([aW]);
  });

  it('patient search: exact phone finds anyone, names only inside the clinic', async () => {
    const byName = await gql<{ searchPatients: unknown[] }>(
      f.api,
      `query{ searchPatients(query:"Patient 0"){ id } }`,
      {},
      w_(),
    );
    expect(byName.body.data?.searchPatients).toEqual([]); // Patient 0 visits Kyiv only
    const own = await gql<{ searchPatients: unknown[] }>(
      f.api,
      `query{ searchPatients(query:"Patient 0"){ id } }`,
      {},
      { cookie: cookies['rk'] },
    );
    expect(own.body.data?.searchPatients.length).toBeGreaterThan(0);
    const byPhone = await gql<{ searchPatients: { id: string }[] }>(
      f.api,
      `query{ searchPatients(query:"+380 50 000 0000"){ id } }`,
      {},
      w_(),
    );
    expect(byPhone.body.data?.searchPatients.map((x) => x.id)).toEqual([w.patients[0]!.id]);
  });
});

describe('Patient.visits is scoped to what the caller may see', () => {
  it("one patient with visits in two clinics: each registrar sees only their clinic's, the patient sees both, the doctor only their own", async () => {
    const kyivVisit = await book(
      w.patients[2]!.actor,
      w.kyiv,
      w.kyivDoctors[3]!,
      w.c30,
      30,
      '11:00',
    );
    const Q = `query($id: ID!){ appointment(id:$id){ patient { id visits { id clinicId doctorId } } } }`;
    type R = { appointment: { patient: { visits: { id: string; clinicId: string }[] } } };
    const ids = async (cookie: string, id: string) =>
      (await gql<R>(f.api, Q, { id }, { cookie })).body.data?.appointment.patient.visits
        .map((v) => v.id)
        .sort();
    expect(await ids(cookies['rk']!, kyivVisit.id)).toEqual([kyivVisit.id]);
    expect(await ids(cookies['rw']!, aW)).toEqual([aW]);
    expect(await ids(cookies['p2']!, aW)).toEqual([kyivVisit.id, aW].sort());
    const doc3 = await login(f.api, 'd3@t.io');
    expect(await ids(doc3, kyivVisit.id)).toEqual([kyivVisit.id]);
    // a doctor of another specialty/clinic cannot reach it at all
    expect(
      (
        await gql<{ appointment: unknown }>(
          f.api,
          Q,
          { id: kyivVisit.id },
          { cookie: cookies['d0'] },
        )
      ).body.data?.appointment,
    ).toBeNull();
  });
});

describe('a doctor sees only their own patients', () => {
  it('own visits listed with the name but without contact details; others invisible', async () => {
    const r = await gql<{
      doctorSchedule: {
        id: string;
        patient: { fullName: string; phone: string | null; email: string | null };
      }[];
    }>(
      f.api,
      `query($d: String!){ doctorSchedule(fromDate:$d, days: 14){ id patient { fullName phone email } } }`,
      { d: workday(25) },
      { cookie: cookies['d0'] },
    );
    expect(r.body.errors).toBeUndefined();
    expect(r.body.data?.doctorSchedule.map((x) => x.id)).toEqual([a0]);
    expect(r.body.data?.doctorSchedule[0]?.patient).toEqual({
      fullName: 'Patient 0',
      phone: null,
      email: null,
    });
    expect(
      (await gql<{ appointment: unknown }>(f.api, GET, { id: a1 }, { cookie: cookies['d0'] })).body
        .data?.appointment,
    ).toBeNull();
    expect(
      codeOf(
        await gql(f.api, `mutation{ markNoShow(id:"${a1}"){ id } }`, {}, { cookie: cookies['d0'] }),
      ),
    ).toBe('NOT_FOUND');
    expect(
      codeOf(
        await gql(
          f.api,
          `mutation{ completeVisit(id:"${a1}"){ id } }`,
          {},
          { cookie: cookies['d0'] },
        ),
      ),
    ).toBe('NOT_FOUND');
  });
  it('doctors cannot do registrar things', async () => {
    const d = { cookie: cookies['d0'] };
    expect(codeOf(await gql(f.api, `mutation{ checkIn(id:"${a0}"){ id } }`, {}, d))).toBe(
      'FORBIDDEN',
    );
    expect(
      codeOf(
        await gql(
          f.api,
          `mutation{ markDoctorSick(input:{doctorId:"${w.kyivDoctors[0]}", localDate:"${workday(25)}"}){ cancelled } }`,
          {},
          d,
        ),
      ),
    ).toBe('FORBIDDEN');
    expect(
      codeOf(
        await gql(
          f.api,
          `query{ clinicBoard(clinicId:"${w.kyiv}", date:"${workday(25)}"){ id } }`,
          {},
          d,
        ),
      ),
    ).toBe('FORBIDDEN');
    expect(
      codeOf(
        await gql(
          f.api,
          `mutation{ cancelAppointment(input:{appointmentId:"${a0}"}){ id } }`,
          {},
          d,
        ),
      ),
    ).toBe('FORBIDDEN');
  });
});

describe('managers see aggregates only', () => {
  it('report works; individual visits and operations do not', async () => {
    const m = { cookie: cookies['m'] };
    const r = await gql(
      f.api,
      `query($f: String!, $t: String!){ report(from:$f, to:$t){ rates { bookings } utilization { doctorId } revenue { currency } } }`,
      { f: workday(0), t: workday(40) },
      m,
    );
    expect(r.body.errors).toBeUndefined();
    expect(
      codeOf(
        await gql(
          f.api,
          `query($f: String!, $t: String!){ report(from:$f, to:$t){ from } }`,
          { f: '2020-01-01', t: '2026-06-30' },
          m,
        ),
      ),
    ).toBe('BAD_USER_INPUT');
    expect(
      (await gql<{ appointment: unknown }>(f.api, GET, { id: a0 }, m)).body.errors?.[0]?.extensions
        ?.code,
    ).toBe('FORBIDDEN');
    expect(
      codeOf(
        await gql(
          f.api,
          `mutation{ cancelAppointment(input:{appointmentId:"${a0}"}){ id } }`,
          {},
          m,
        ),
      ),
    ).toBe('FORBIDDEN');
    expect(codeOf(await gql(f.api, `query{ myAppointments { id } }`, {}, m))).toBe('FORBIDDEN');
    expect(
      codeOf(
        await gql(
          f.api,
          `query($f: String!, $t: String!){ report(from:$f, to:$t){ from } }`,
          { f: workday(0), t: workday(40) },
          { cookie: cookies['rk'] },
        ),
      ),
    ).toBe('FORBIDDEN');
  });
});
