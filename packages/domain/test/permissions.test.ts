import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  cancelAppointment,
  checkIn,
  completeVisit,
  confirmBooking,
  declineOffer,
  holdSlot,
  joinWaitlist,
  leaveWaitlist,
  markNoShow,
  rescheduleAppointment,
  type Actor,
  type Ctx,
} from '../src/index.js';
import {
  T0,
  at,
  codeOf,
  createTestDb,
  makeCtx,
  makeWorld,
  must,
  rows,
  workday,
  type Clock,
  type TestDb,
  type World,
} from './helpers.js';

let t: TestDb;
let w: World;
const clock: Clock = { now: T0 };
let ctx: Ctx;
let n = 0;
const k = (): string => `pk-${++n}-${Math.random().toString(36).slice(2)}`;
const P = (i: number): Actor => (w.patients[i] as World['patients'][number]).actor;

beforeAll(async () => {
  t = await createTestDb();
  w = await makeWorld(t.db);
  ctx = makeCtx(t.db, clock);
});
afterAll(async () => {
  await t.drop();
});

const snapshot = async (id: string) =>
  (
    await rows(
      t.db,
      sql`SELECT status, version, starts_at, patient_id, cancelled_at FROM appointments WHERE id = ${id}::uuid`,
    )
  )[0];
const eventCount = async (id: string): Promise<number> =>
  Number(
    (
      await rows<{ n: number }>(
        t.db,
        sql`SELECT count(*)::int AS n FROM appointment_events WHERE appointment_id = ${id}::uuid`,
      )
    )[0]?.n,
  );

describe('nobody touches a visit that is not theirs (invariant 13 at the engine level)', () => {
  it('patient B, registrar of another clinic and a stranger doctor get "not found" and change nothing', async () => {
    const h = must(
      await holdSlot(ctx, P(0), {
        clinicId: w.kyiv,
        doctorId: w.kyivDoctors[0] as string,
        serviceId: w.c30,
        startsAt: at(workday(2), '10:00'),
      }),
    );
    const a = must(await confirmBooking(ctx, P(0), { appointmentId: h.id, idempotencyKey: k() }));
    const before = await snapshot(a.id);
    const events = await eventCount(a.id);
    clock.now = new Date(a.startsAt.getTime() - 20 * 60_000);
    const attackers: [string, Actor][] = [
      ['patient B', P(1)],
      ['registrar of Warsaw', w.registrar.warsaw],
      ['another doctor', w.doctorActor(1)],
    ];
    for (const [label, who] of attackers) {
      const results = {
        cancel: await cancelAppointment(ctx, who, { appointmentId: a.id }),
        reschedule: await rescheduleAppointment(ctx, who, {
          appointmentId: a.id,
          newStartsAt: at(workday(3), '10:00'),
        }),
        checkIn: await checkIn(ctx, who, a.id),
        noShow: await markNoShow(ctx, who, a.id),
        complete: await completeVisit(ctx, who, a.id),
        confirm: await confirmBooking(ctx, who, { appointmentId: a.id, idempotencyKey: k() }),
      };
      for (const [op, r] of Object.entries(results))
        expect(['NOT_FOUND', 'FORBIDDEN'], `${label} ${op}`).toContain(codeOf(r));
    }
    expect(await snapshot(a.id)).toEqual(before);
    expect(await eventCount(a.id)).toBe(events);
    clock.now = T0;
  });

  it("wrong roles on one's own data are refused too", async () => {
    const h = must(
      await holdSlot(ctx, P(2), {
        clinicId: w.kyiv,
        doctorId: w.kyivDoctors[1] as string,
        serviceId: w.c30,
        startsAt: at(workday(2), '10:00'),
      }),
    );
    const a = must(await confirmBooking(ctx, P(2), { appointmentId: h.id, idempotencyKey: k() }));
    expect(codeOf(await checkIn(ctx, P(2), a.id))).toBe('FORBIDDEN');
    expect(codeOf(await markNoShow(ctx, P(2), a.id))).toBe('FORBIDDEN');
    expect(codeOf(await completeVisit(ctx, P(2), a.id))).toBe('FORBIDDEN');
    expect(codeOf(await cancelAppointment(ctx, w.doctorActor(1), { appointmentId: a.id }))).toBe(
      'FORBIDDEN',
    );
    expect(
      codeOf(
        await cancelAppointment(ctx, { userId: null, role: 'manager' }, { appointmentId: a.id }),
      ),
    ).toBe('FORBIDDEN');
    expect(
      codeOf(
        await rescheduleAppointment(ctx, w.doctorActor(1), {
          appointmentId: a.id,
          newStartsAt: at(workday(3), '10:00'),
        }),
      ),
    ).toBe('FORBIDDEN');
    expect((await snapshot(a.id))?.['status']).toBe('booked');
  });

  it('unknown ids and malformed ids are client errors, never exceptions', async () => {
    const ghost = '00000000-0000-4000-8000-000000000000';
    expect(codeOf(await cancelAppointment(ctx, P(3), { appointmentId: ghost }))).toBe('NOT_FOUND');
    expect(
      codeOf(await confirmBooking(ctx, P(3), { appointmentId: ghost, idempotencyKey: k() })),
    ).toBe('NOT_FOUND');
    expect(codeOf(await declineOffer(ctx, P(3), ghost))).toBe('NOT_FOUND');
    expect(codeOf(await leaveWaitlist(ctx, P(3), ghost))).toBe('NOT_FOUND');
    for (const bad of ['not-a-uuid', "1' OR '1'='1", '', '00000000-0000-4000-8000-00000000000Z']) {
      expect(codeOf(await cancelAppointment(ctx, P(3), { appointmentId: bad })), bad).toBe(
        'BAD_USER_INPUT',
      );
      expect(codeOf(await checkIn(ctx, w.registrar.kyiv, bad)), bad).toBe('BAD_USER_INPUT');
    }
    const st = await rows<{ n: number }>(t.db, sql`SELECT count(*)::int AS n FROM appointments`);
    expect(st[0]?.n).toBeGreaterThan(0);
  });

  it('waiting-list requests belong to their patient', async () => {
    const e = must(
      await joinWaitlist(ctx, P(4), {
        doctorId: w.kyivDoctors[0] as string,
        serviceId: w.c30,
        fromDate: workday(5),
        toDate: workday(7),
      }),
    );
    expect(codeOf(await leaveWaitlist(ctx, P(5), e.id))).toBe('NOT_FOUND');
    expect(codeOf(await leaveWaitlist(ctx, w.registrar.kyiv, e.id))).toBe('NOT_FOUND');
    expect(
      (
        await rows<{ status: string }>(
          t.db,
          sql`SELECT status FROM waitlist_entries WHERE id = ${e.id}::uuid`,
        )
      )[0]?.status,
    ).toBe('active');
  });

  it('a hold belongs to its patient: another patient cannot confirm it even with a fresh key', async () => {
    const h = must(
      await holdSlot(ctx, P(6), {
        clinicId: w.kyiv,
        doctorId: w.kyivDoctors[2] as string,
        serviceId: w.c30,
        startsAt: at(workday(2), '10:00'),
      }),
    );
    expect(
      codeOf(await confirmBooking(ctx, P(7), { appointmentId: h.id, idempotencyKey: k() })),
    ).toBe('NOT_FOUND');
    expect(
      codeOf(
        await confirmBooking(ctx, w.registrar.warsaw, { appointmentId: h.id, idempotencyKey: k() }),
      ),
    ).toBe('NOT_FOUND');
    expect((await snapshot(h.id))?.['status']).toBe('held');
  });
});
