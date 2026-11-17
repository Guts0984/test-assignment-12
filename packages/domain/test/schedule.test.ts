import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  confirmBooking, getAvailability, holdSlot, removeScheduleException, removeScheduleTemplate, setScheduleException, setScheduleTemplate, type Actor, type Ctx,
} from '../src/index.js';
import { T0, at, codeOf, count, createTestDb, makeCtx, makeWorld, must, workday, type Clock, type TestDb, type World } from './helpers.js';

let t: TestDb;
let w: World;
const clock: Clock = { now: T0 };
let ctx: Ctx;
const P = (i: number): Actor => (w.patients[i] as World['patients'][number]).actor;
const doc = (i: number): string => w.kyivDoctors[i] as string;

beforeAll(async () => {
  t = await createTestDb();
  w = await makeWorld(t.db);
  ctx = makeCtx(t.db, clock);
});
afterAll(async () => {
  await t.drop();
});

const tpl = (doctor: number, weekday: number, over: Record<string, unknown> = {}) => ({
  doctorId: doc(doctor), clinicId: w.kyiv, weekday, startLocal: '09:00', endLocal: '17:00', breakStartLocal: null as string | null, breakEndLocal: null as string | null, ...over,
});
const day = async (doctor: number, d: string, svc = w.c30) => {
  const g = must(await getAvailability(ctx, { clinicId: w.kyiv, serviceId: svc, doctorId: doc(doctor), fromDate: d, days: 1 }));
  return g.slots.map((s) => s.localTime);
};
const book = async (who: number, doctor: number, d: string, time: string) => {
  const h = must(await holdSlot(ctx, P(who), { clinicId: w.kyiv, doctorId: doc(doctor), serviceId: w.c30, startsAt: at(d, time) }));
  return must(await confirmBooking(ctx, P(who), { appointmentId: h.id, idempotencyKey: `s-${who}-${d}-${time}` }));
};

describe('weekly template', () => {
  it('the registrar of the clinic edits it, and the grid follows', async () => {
    must(await setScheduleTemplate(ctx, w.registrar.kyiv, tpl(0, 3, { startLocal: '10:00', endLocal: '12:00' })));
    const d = workday(0); // Wednesday
    expect(await day(0, d)).toEqual(['10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30']);
    must(await setScheduleTemplate(ctx, w.registrar.kyiv, tpl(0, 3, { breakStartLocal: '11:00', breakEndLocal: '11:30' })));
    const range = (from: number, to: number): string[] => Array.from({ length: (to - from) / 15 + 1 }, (_, i) => { const m = from + i * 15; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; });
    expect(await day(0, d)).toEqual([...range(9 * 60, 10 * 60 + 30), ...range(11 * 60 + 30, 16 * 60 + 30)]);
  });

  it('other clinics, other roles and nonsense are refused', async () => {
    expect(codeOf(await setScheduleTemplate(ctx, w.registrar.warsaw, tpl(0, 1)))).toBe('FORBIDDEN'); // Kyiv clinic's template
    expect(codeOf(await setScheduleTemplate(ctx, P(0), tpl(0, 1)))).toBe('FORBIDDEN');
    expect(codeOf(await setScheduleTemplate(ctx, w.doctorActor(0), tpl(0, 1)))).toBe('FORBIDDEN');
    expect(codeOf(await setScheduleTemplate(ctx, { userId: null, role: 'manager' }, tpl(0, 1)))).toBe('FORBIDDEN');
    expect(codeOf(await removeScheduleTemplate(ctx, w.registrar.warsaw, { doctorId: doc(0), clinicId: w.kyiv, weekday: 1 }))).toBe('FORBIDDEN');
  });

  it('a doctor works in one clinic per weekday: the other clinic cannot take that weekday', async () => {
    const r = await setScheduleTemplate(ctx, w.registrar.warsaw, { doctorId: doc(1), clinicId: w.warsaw, weekday: 2, startLocal: '09:00', endLocal: '12:00', breakStartLocal: null, breakEndLocal: null });
    expect(codeOf(r)).toBe('SCHEDULE_CONFLICT');
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM schedule_templates WHERE doctor_id = ${doc(1)}::uuid AND weekday = 2 AND clinic_id = ${w.kyiv}::uuid`)).toBe(1);
    // …but a free weekday (Saturday) works: a doctor can work in two clinics on different days
    must(await setScheduleTemplate(ctx, w.registrar.warsaw, { doctorId: doc(1), clinicId: w.warsaw, weekday: 6, startLocal: '09:00', endLocal: '12:00', breakStartLocal: null, breakEndLocal: null }));
    const g = must(await getAvailability(ctx, { clinicId: w.warsaw, serviceId: w.c30, doctorId: doc(1), fromDate: '2026-06-13', days: 1 }));
    expect(g.slots.length).toBeGreaterThan(0);
    expect(g.currency).toBe('PLN');
  });

  it('shrinking the hours below existing visits is refused until they are moved', async () => {
    const a = await book(0, 2, workday(3), '16:00');
    const r = await setScheduleTemplate(ctx, w.registrar.kyiv, tpl(2, a.startsAt.getUTCDay() === 0 ? 7 : a.startsAt.getUTCDay(), { endLocal: '15:00' }));
    expect(codeOf(r)).toBe('SCHEDULE_CONFLICT');
    expect((await getAvailability(ctx, { clinicId: w.kyiv, serviceId: w.c30, doctorId: doc(2), fromDate: workday(3), days: 1 })).ok).toBe(true);
    expect(codeOf(await removeScheduleTemplate(ctx, w.registrar.kyiv, { doctorId: doc(2), clinicId: w.kyiv, weekday: a.startsAt.getUTCDay() }))).toBe('SCHEDULE_CONFLICT');
  });

  it('a break that lands on a visit is refused', async () => {
    const d = workday(4);
    const a = await book(1, 3, d, '10:00');
    const wd = a.startsAt.getUTCDay();
    expect(codeOf(await setScheduleTemplate(ctx, w.registrar.kyiv, tpl(3, wd, { breakStartLocal: '10:15', breakEndLocal: '10:45' })))).toBe('SCHEDULE_CONFLICT');
    must(await setScheduleTemplate(ctx, w.registrar.kyiv, tpl(3, wd, { breakStartLocal: '12:00', breakEndLocal: '13:00' })));
  });
});

describe('exceptions', () => {
  it('vacation removes the day; extra day adds one; custom hours replace; removing restores', async () => {
    const d = workday(5);
    must(await setScheduleException(ctx, w.registrar.kyiv, { doctorId: doc(4), localDate: d, kind: 'vacation' }));
    expect(await day(4, d)).toEqual([]);
    must(await removeScheduleException(ctx, w.registrar.kyiv, { doctorId: doc(4), localDate: d }));
    expect((await day(4, d)).length).toBeGreaterThan(20);
    must(await setScheduleException(ctx, w.registrar.kyiv, { doctorId: doc(4), localDate: d, kind: 'custom_hours', clinicId: w.kyiv, startLocal: '10:00', endLocal: '11:00' }));
    expect(await day(4, d)).toEqual(['10:00', '10:15', '10:30']);
    must(await setScheduleException(ctx, w.registrar.kyiv, { doctorId: doc(4), localDate: '2026-06-14', kind: 'extra_day', clinicId: w.kyiv, startLocal: '10:00', endLocal: '11:00' }));
    expect(await day(4, '2026-06-14')).toEqual(['10:00', '10:15', '10:30']);
  });

  it('cannot take away a day that has visits (that is what the sick day is for)', async () => {
    const d = workday(6);
    await book(2, 5, d, '10:00');
    expect(codeOf(await setScheduleException(ctx, w.registrar.kyiv, { doctorId: doc(5), localDate: d, kind: 'vacation' }))).toBe('SCHEDULE_CONFLICT');
    expect(codeOf(await setScheduleException(ctx, w.registrar.kyiv, { doctorId: doc(5), localDate: d, kind: 'day_off' }))).toBe('SCHEDULE_CONFLICT');
    expect(codeOf(await setScheduleException(ctx, w.registrar.kyiv, { doctorId: doc(5), localDate: d, kind: 'custom_hours', clinicId: w.kyiv, startLocal: '12:00', endLocal: '15:00' }))).toBe('SCHEDULE_CONFLICT');
    must(await setScheduleException(ctx, w.registrar.kyiv, { doctorId: doc(5), localDate: d, kind: 'custom_hours', clinicId: w.kyiv, startLocal: '09:00', endLocal: '12:00' }));
    const sick = await setScheduleException(ctx, w.registrar.kyiv, { doctorId: doc(5), localDate: d, kind: 'sick' });
    expect(sick.ok).toBe(true);
    expect(await day(5, d)).toEqual([]);
  });

  it('scope: only the clinic\'s own registrar, only for doctors working there', async () => {
    const d = workday(7);
    expect(codeOf(await setScheduleException(ctx, w.registrar.warsaw, { doctorId: doc(0), localDate: d, kind: 'vacation' }))).toBe('NOT_FOUND');
    expect(codeOf(await setScheduleException(ctx, w.registrar.warsaw, { doctorId: doc(0), localDate: d, kind: 'extra_day', clinicId: w.kyiv, startLocal: '10:00', endLocal: '12:00' }))).toBe('FORBIDDEN');
    expect(codeOf(await setScheduleException(ctx, P(0), { doctorId: doc(0), localDate: d, kind: 'vacation' }))).toBe('FORBIDDEN');
    expect(codeOf(await removeScheduleException(ctx, w.registrar.warsaw, { doctorId: doc(0), localDate: d }))).toBe('NOT_FOUND');
    expect(await count(t.db, sql`SELECT count(*)::int AS n FROM schedule_exceptions WHERE local_date = ${d}::date`)).toBe(0);
  });
});
