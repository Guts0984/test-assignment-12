import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { loadAvailabilityInputs, loadReport, schema } from '../src/index.js';
import { MIN, T, createTestDb, insertAppt, makeWorld, type TestDb, type World } from './helpers.js';

let t: TestDb;
let w: World;
// Monday 2026-06-08 09:00 Kyiv = 06:00Z
const MON9 = T('2026-06-08T06:00:00Z');
const NOW = T('2026-06-01T00:00:00Z');
const at = (min: number, dayOffset = 0): Date =>
  new Date(MON9.getTime() + dayOffset * 86_400_000 + min * MIN);

beforeAll(async () => {
  t = await createTestDb();
  w = await makeWorld(t.db);
});
afterAll(async () => {
  await t.drop();
});

const params = (over: Partial<Parameters<typeof loadAvailabilityInputs>[1]> = {}) => ({
  clinicId: w.kyiv,
  serviceId: w.consult30,
  windowStart: T('2026-06-07T00:00:00Z'),
  windowEnd: T('2026-06-22T00:00:00Z'),
  fromDate: '2026-06-08',
  toDate: '2026-06-21',
  now: NOW,
  ...over,
});

describe('availability inputs', () => {
  it('only doctors who work in the clinic and provide the service', async () => {
    // doctors[0..1] work in Kyiv; doctors[2] only in Warsaw; the rest have no schedule at all
    await t.db.insert(schema.scheduleTemplates).values([
      {
        doctorId: w.doctors[0] as string,
        clinicId: w.kyiv,
        weekday: 1,
        startLocal: '09:00',
        endLocal: '17:00',
        breakStartLocal: '13:00',
        breakEndLocal: '14:00',
      },
      {
        doctorId: w.doctors[1] as string,
        clinicId: w.kyiv,
        weekday: 2,
        startLocal: '09:00',
        endLocal: '17:00',
      },
      {
        doctorId: w.doctors[2] as string,
        clinicId: w.warsaw,
        weekday: 1,
        startLocal: '09:00',
        endLocal: '17:00',
      },
    ]);
    const r = await loadAvailabilityInputs(t.db, params());
    expect(r.doctors.map((d) => d.id).sort()).toEqual([w.doctors[0], w.doctors[1]].sort());
    expect(r.templates).toHaveLength(2);
    expect(r.templates.find((x) => x.doctorId === w.doctors[0])).toMatchObject({
      weekday: 1,
      startLocal: '09:00',
      endLocal: '17:00',
      breakStartLocal: '13:00',
      breakEndLocal: '14:00',
    });
    expect(r.clinic?.timeZone).toBe('Europe/Kyiv');
    expect(r.service).toMatchObject({ durationMin: 30, needsUltrasound: false });
  });

  it('a chosen doctor narrows the result; a stranger id yields nothing, not an error', async () => {
    const one = await loadAvailabilityInputs(t.db, params({ doctorId: w.doctors[1] as string }));
    expect(one.doctors.map((d) => d.id)).toEqual([w.doctors[1]]);
    const none = await loadAvailabilityInputs(
      t.db,
      params({ doctorId: '00000000-0000-4000-8000-000000000000' }),
    );
    expect(none.doctors).toEqual([]);
    const noClinic = await loadAvailabilityInputs(
      t.db,
      params({ clinicId: '00000000-0000-4000-8000-000000000000' }),
    );
    expect(noClinic.clinic).toBeNull();
  });

  it('busy time: cancelled ignored, expired regular holds ignored, live holds and waitlist offers block', async () => {
    const doc = w.doctors[0] as string;
    const mk = (min: number, patient: number, over: Partial<Parameters<typeof insertAppt>[1]>) =>
      insertAppt(t.db, {
        patientId: w.patients[patient] as string,
        doctorId: doc,
        clinicId: w.kyiv,
        serviceId: w.consult30,
        startsAt: at(min),
        minutes: 30,
        ...over,
      });
    await mk(0, 0, { status: 'booked' });
    await mk(45, 1, { status: 'cancelled' });
    await mk(90, 2, { status: 'held', holdExpiresAt: T('2026-05-31T00:00:00Z') }); // expired before NOW
    await mk(135, 3, { status: 'held', holdExpiresAt: T('2026-06-02T00:00:00Z') }); // alive
    await mk(180, 4, {
      status: 'held',
      kind: 'waitlist_offer',
      holdExpiresAt: T('2026-05-31T00:00:00Z'),
    }); // offer: stays blocking
    const r = await loadAvailabilityInputs(t.db, params());
    const starts = r.doctorBusy
      .filter((b) => b.doctorId === doc)
      .map((b) => b.startsAt.getTime())
      .sort();
    expect(starts).toEqual([at(0), at(135), at(180)].map((d) => d.getTime()));
    const first = r.doctorBusy.find((b) => b.startsAt.getTime() === at(0).getTime());
    expect(first?.occupiedUntil.getTime()).toBe(at(35).getTime()); // visit + 5 min prep
  });

  it('busy time outside the window is not returned; other doctors are not mixed in', async () => {
    await insertAppt(t.db, {
      patientId: w.patients[5] as string,
      doctorId: w.doctors[0] as string,
      clinicId: w.kyiv,
      serviceId: w.consult30,
      startsAt: at(0, 40),
      minutes: 30,
    });
    await insertAppt(t.db, {
      patientId: w.patients[6] as string,
      doctorId: w.doctors[5] as string,
      clinicId: w.kyiv,
      serviceId: w.consult30,
      startsAt: at(0, 1),
      minutes: 30,
    });
    const r = await loadAvailabilityInputs(t.db, params());
    expect(r.doctorBusy.some((b) => b.startsAt.getTime() === at(0, 40).getTime())).toBe(false);
    expect(r.doctorBusy.some((b) => b.doctorId === w.doctors[5])).toBe(false);
  });

  it('room busy time appears only for ultrasound services, and includes bookings of other doctors', async () => {
    await insertAppt(t.db, {
      patientId: w.patients[7] as string,
      doctorId: w.doctors[1] as string,
      clinicId: w.kyiv,
      serviceId: w.uzi30,
      startsAt: at(300),
      minutes: 30,
    });
    const uzi = await loadAvailabilityInputs(
      t.db,
      params({ serviceId: w.uzi30, doctorId: w.doctors[0] as string }),
    );
    expect(uzi.roomBusy.map((b) => b.startsAt.getTime())).toContain(at(300).getTime());
    const plain = await loadAvailabilityInputs(t.db, params());
    expect(plain.roomBusy).toEqual([]);
    const warsawRoom = await loadAvailabilityInputs(
      t.db,
      params({ clinicId: w.warsaw, serviceId: w.uzi30 }),
    );
    expect(warsawRoom.roomBusy).toEqual([]);
  });

  it('exceptions in the date range come back; SQL-hostile ids cannot inject', async () => {
    await t.db
      .insert(schema.scheduleExceptions)
      .values({ doctorId: w.doctors[0] as string, localDate: '2026-06-15', kind: 'vacation' });
    const r = await loadAvailabilityInputs(t.db, params());
    expect(r.exceptions).toEqual([
      expect.objectContaining({
        doctorId: w.doctors[0],
        localDate: '2026-06-15',
        kind: 'vacation',
      }),
    ]);
    await expect(
      loadAvailabilityInputs(t.db, params({ clinicId: "x'; DROP TABLE appointments;--" })),
    ).rejects.toThrow();
    const still = await t.db.execute(sql`SELECT count(*)::int AS n FROM appointments`);
    expect(Number((still.rows[0] as { n: number }).n)).toBeGreaterThan(0);
  });
});

describe('report', () => {
  let t2: TestDb;
  let w2: World;
  beforeAll(async () => {
    t2 = await createTestDb();
    w2 = await makeWorld(t2.db);
    const d = w2.doctors[0] as string;
    // Doctor works Mon 09:00-17:00 with 1h break = 420 working minutes per Monday.
    await t2.db.insert(schema.scheduleTemplates).values({
      doctorId: d,
      clinicId: w2.kyiv,
      weekday: 1,
      startLocal: '09:00',
      endLocal: '17:00',
      breakStartLocal: '13:00',
      breakEndLocal: '14:00',
    });
    // period 2026-06-01 .. 2026-06-14 has Mondays 1st, 8th; the 8th is a vacation => only 1 working Monday
    await t2.db
      .insert(schema.scheduleExceptions)
      .values({ doctorId: d, localDate: '2026-06-08', kind: 'vacation' });
    // plus an extra Saturday 10:00-14:00 (240 min) in Kyiv
    await t2.db.insert(schema.scheduleExceptions).values({
      doctorId: d,
      localDate: '2026-06-13',
      kind: 'extra_day',
      clinicId: w2.kyiv,
      startLocal: '10:00',
      endLocal: '14:00',
    });
    const base = T('2026-06-01T06:00:00Z'); // Mon 09:00 Kyiv
    const mk = async (
      patient: number,
      min: number,
      status: 'completed' | 'no_show' | 'cancelled' | 'booked',
      over: {
        late?: boolean;
        booked?: boolean;
        svc?: string;
        clinic?: string;
        doctor?: string;
      } = {},
    ) => {
      const id = await insertAppt(t2.db, {
        patientId: w2.patients[patient] as string,
        doctorId: over.doctor ?? d,
        clinicId: over.clinic ?? w2.kyiv,
        serviceId: over.svc ?? w2.consult30,
        startsAt: new Date(base.getTime() + min * MIN),
        minutes: over.svc === w2.quick15 ? 15 : 30,
        status: 'booked',
      });
      await t2.db.execute(
        sql`UPDATE appointments SET booked_at = ${over.booked === false ? null : '2026-05-20T00:00:00Z'}::timestamptz WHERE id = ${id}::uuid`,
      );
      if (status !== 'booked') {
        if (status === 'completed')
          await t2.db.execute(
            sql`UPDATE appointments SET status = 'checked_in' WHERE id = ${id}::uuid`,
          );
        await t2.db.execute(
          sql`UPDATE appointments SET status = ${status}::appointment_status, cancelled_late = ${over.late ?? false} WHERE id = ${id}::uuid`,
        );
      }
      return id;
    };
    await mk(0, 0, 'completed'); // 30 min, 100000
    await mk(1, 60, 'completed', { svc: w2.quick15 }); // 15 min
    await mk(2, 120, 'no_show'); // 30 min
    await mk(3, 180, 'cancelled', { late: true }); // late cancel, not counted in minutes
    await mk(4, 240, 'cancelled', { late: false });
    await mk(5, 300, 'cancelled', { booked: false }); // abandoned hold: not a booking at all
    await mk(6, 360, 'booked'); // 30 min live
    // Warsaw visit with PLN price, completed
    const wid = await insertAppt(t2.db, {
      patientId: w2.patients[7] as string,
      doctorId: w2.warsawDoctor,
      clinicId: w2.warsaw,
      serviceId: w2.consult30,
      startsAt: new Date(base.getTime() + 60 * MIN),
      minutes: 30,
      status: 'booked',
    });
    await t2.db.execute(
      sql`UPDATE appointments SET booked_at = now(), currency = 'PLN', price_minor = 25000 WHERE id = ${wid}::uuid`,
    );
    await t2.db.execute(sql`UPDATE appointments SET status = 'checked_in' WHERE id = ${wid}::uuid`);
    await t2.db.execute(sql`UPDATE appointments SET status = 'completed' WHERE id = ${wid}::uuid`);
    // waitlist offers: 2 offered, 1 accepted
    const a1 = await t2.db.execute(
      sql`SELECT id FROM appointments WHERE patient_id = ${w2.patients[6]}::uuid`,
    );
    const a2 = await t2.db.execute(
      sql`SELECT id FROM appointments WHERE patient_id = ${w2.patients[4]}::uuid`,
    );
    const [e1] = await t2.db
      .insert(schema.waitlistEntries)
      .values({
        patientId: w2.patients[6] as string,
        doctorId: d,
        serviceId: w2.consult30,
        fromDate: '2026-06-01',
        toDate: '2026-06-10',
      })
      .returning();
    const [e2] = await t2.db
      .insert(schema.waitlistEntries)
      .values({
        patientId: w2.patients[4] as string,
        doctorId: d,
        serviceId: w2.consult30,
        fromDate: '2026-06-01',
        toDate: '2026-06-10',
      })
      .returning();
    await t2.db.insert(schema.waitlistOffers).values([
      {
        entryId: (e1 as { id: string }).id,
        appointmentId: (a1.rows[0] as { id: string }).id,
        expiresAt: T('2026-06-01T00:00:00Z'),
        status: 'accepted',
      },
      {
        entryId: (e2 as { id: string }).id,
        appointmentId: (a2.rows[0] as { id: string }).id,
        expiresAt: T('2026-06-01T00:00:00Z'),
        status: 'expired',
      },
    ]);
  });
  afterAll(async () => {
    await t2.drop();
  });

  it('utilization = live visit minutes ÷ working minutes with exceptions applied', async () => {
    const r = await loadReport(t2.db, { from: '2026-06-01', to: '2026-06-14', clinicId: w2.kyiv });
    const u = r.utilization.find((x) => x.doctorId === w2.doctors[0]);
    // working: Mon Jun 1 = 420 (Jun 8 is vacation) + extra Saturday 240 = 660
    expect(u?.workMinutes).toBe(660);
    // live visits: completed 30 + completed 15 + no_show 30 + booked 30 = 105
    expect(u?.bookedMinutes).toBe(105);
    expect(u?.percent).toBe(15.9);
    expect(r.utilization.every((x) => x.clinicId === w2.kyiv)).toBe(true);
  });

  it('rates count only visits that were ever booked (abandoned holds are not bookings)', async () => {
    const r = await loadReport(t2.db, { from: '2026-06-01', to: '2026-06-14', clinicId: w2.kyiv });
    // booked ever: 2 completed + no_show + 2 cancelled + booked = 6 (abandoned excluded)
    expect(r.rates).toEqual({
      bookings: 6,
      noShows: 1,
      lateCancels: 1,
      noShowPercent: 16.7,
      lateCancelPercent: 16.7,
    });
  });

  it('revenue never mixes currencies', async () => {
    const r = await loadReport(t2.db, { from: '2026-06-01', to: '2026-06-14' });
    const uah = r.revenue.filter((x) => x.currency === 'UAH');
    const pln = r.revenue.filter((x) => x.currency === 'PLN');
    expect(uah.reduce((s, x) => s + x.revenueMinor, 0)).toBe(200_000);
    expect(pln.reduce((s, x) => s + x.revenueMinor, 0)).toBe(25_000);
    expect(uah.reduce((s, x) => s + x.visits, 0)).toBe(2);
  });

  it('waitlist acceptance rate', async () => {
    const r = await loadReport(t2.db, { from: '2026-06-01', to: '2026-06-14' });
    expect(r.waitlist).toEqual({ offered: 2, accepted: 1, acceptedPercent: 50 });
  });

  it('empty period and unknown clinic give zeros, not NaN or errors', async () => {
    const r = await loadReport(t2.db, {
      from: '2030-01-01',
      to: '2030-01-31',
      clinicId: '00000000-0000-4000-8000-000000000000',
    });
    expect(r.utilization).toEqual([]);
    expect(r.rates).toEqual({
      bookings: 0,
      noShows: 0,
      lateCancels: 0,
      noShowPercent: 0,
      lateCancelPercent: 0,
    });
    expect(r.waitlist.acceptedPercent).toBe(0);
    expect(r.revenue).toEqual([]);
  });

  it('boundaries are inclusive and use clinic-local dates', async () => {
    const r = await loadReport(t2.db, { from: '2026-06-01', to: '2026-06-01', clinicId: w2.kyiv });
    expect(r.utilization.find((x) => x.doctorId === w2.doctors[0])?.workMinutes).toBe(420);
    expect(r.rates.bookings).toBe(6);
  });
});
