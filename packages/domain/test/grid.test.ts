import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { addDays, instantToLocal, isoWeekday, localToInstant, minutesOfTime, timeOfMinutes } from '@clinic/shared';
import { computeSlots, workingIntervals, type GridInput } from '../src/index.js';

const CLINIC = 'c1';
const D1 = 'd1';
const NOW = new Date('2026-06-01T00:00:00Z');
const MIN = 60_000;

const tpl = (over: Partial<GridInput['templates'][number]> = {}): GridInput['templates'][number] => ({
  doctorId: D1, weekday: 3, startLocal: '09:00', endLocal: '17:00', breakStartLocal: '13:00', breakEndLocal: '14:00', ...over,
});

const base = (over: Partial<GridInput> = {}): GridInput => ({
  timeZone: 'Europe/Kyiv', clinicId: CLINIC, durationMin: 30, needsUltrasound: false, prepMinutes: 5,
  fromDate: '2026-06-10', days: 1, now: NOW, minLeadMinutes: 120, maxAdvanceDays: 60,
  doctorIds: [D1], templates: [tpl()], exceptions: [], doctorBusy: [], roomBusy: [], ...over,
});

const at = (date: string, time: string, tz = 'Europe/Kyiv'): Date => {
  const r = localToInstant(date, time, tz);
  if (!r.ok) throw new Error('nonexistent');
  return r.value;
};
const times = (slots: ReturnType<typeof computeSlots>): string[] => slots.map((s) => s.localTime);

describe('free-time grid: the rules, one by one', () => {
  it('Wednesday 09:00–17:00 with a 13:00–14:00 break, 30-minute service: exact list', () => {
    const t = times(computeSlots(base()));
    const morning = Array.from({ length: 15 }, (_, i) => timeOfMinutes(9 * 60 + i * 15)); // 09:00 … 12:30
    const afternoon = Array.from({ length: 11 }, (_, i) => timeOfMinutes(14 * 60 + i * 15)); // 14:00 … 16:30
    expect(t).toEqual([...morning, ...afternoon]);
  });

  it('every start is on :00 :15 :30 :45', () => {
    for (const s of computeSlots(base({ days: 14, fromDate: '2026-06-08' }))) expect(minutesOfTime(s.localTime) % 15).toBe(0);
  });

  it('a visit never crosses the break nor the end of the day', () => {
    const t = times(computeSlots(base()));
    expect(t).not.toContain('12:45'); // would end 13:15
    expect(t).not.toContain('13:00');
    expect(t).not.toContain('13:45');
    expect(t).toContain('12:30'); // ends exactly at the break
    expect(t).toContain('14:00');
    expect(t).not.toContain('16:45'); // would end 17:15
    expect(t).toContain('16:30');
  });

  it('90-minute services fit only where 90 free minutes exist', () => {
    const t = times(computeSlots(base({ durationMin: 90 })));
    expect(t[t.length - 1]).toBe('15:30');
    expect(t).toContain('11:30'); // ends 13:00
    expect(t).not.toContain('11:45');
  });

  it('a break that touches the day boundary leaves a single interval', () => {
    expect(workingIntervals(base({ templates: [tpl({ breakStartLocal: '09:00', breakEndLocal: '10:00' })] }), D1, '2026-06-10')).toEqual([{ start: 600, end: 1020 }]);
    expect(workingIntervals(base({ templates: [tpl({ breakStartLocal: '16:00', breakEndLocal: '17:00' })] }), D1, '2026-06-10')).toEqual([{ start: 540, end: 960 }]);
  });

  it('5 minutes of preparation follow every visit: 10:00–10:30 blocks 09:30…10:30, frees 09:15 and 10:45', () => {
    const busy = [{ doctorId: D1, startsAt: at('2026-06-10', '10:00'), occupiedUntil: at('2026-06-10', '10:35') }];
    const t = times(computeSlots(base({ doctorBusy: busy })));
    for (const blocked of ['09:30', '09:45', '10:00', '10:15', '10:30']) expect(t, blocked).not.toContain(blocked);
    expect(t).toContain('09:15'); // 09:15–09:45 + 5 prep = 09:50, before 10:00
    expect(t).toContain('10:45');
  });

  it('the preparation after the last visit may run past closing time', () => {
    expect(times(computeSlots(base()))).toContain('16:30');
  });

  it('an unrelated doctor\'s busy time does not matter', () => {
    const busy = [{ doctorId: 'other', startsAt: at('2026-06-10', '10:00'), occupiedUntil: at('2026-06-10', '10:35') }];
    expect(computeSlots(base({ doctorBusy: busy }))).toHaveLength(26);
  });

  it('booking window: starts exactly 2 hours ahead are free, a minute earlier are not', () => {
    const now = new Date(at('2026-06-10', '10:00').getTime() - 120 * MIN);
    const t = times(computeSlots(base({ now })));
    expect(t[0]).toBe('10:00');
    const now2 = new Date(now.getTime() + MIN);
    expect(times(computeSlots(base({ now: now2 })))[0]).toBe('10:15');
  });

  it('booking window: not later than 60 days', () => {
    const lastDay = addDays('2026-06-01', 60); // 2026-07-31 is a Friday; use template for that weekday
    const wd = isoWeekday(lastDay);
    const inputs = (now: Date) => base({ now, fromDate: lastDay, templates: [tpl({ weekday: wd })] });
    const edge = at(lastDay, '10:00');
    const now = new Date(edge.getTime() - 60 * 86_400_000);
    expect(times(computeSlots(inputs(now)))).toContain('10:00');
    expect(times(computeSlots(inputs(new Date(now.getTime() - MIN))))).not.toContain('10:00');
    expect(times(computeSlots(inputs(now)))).not.toContain('10:15');
  });

  it('exceptions: vacation / sick / day off remove the day; extra day adds one; custom hours replace', () => {
    const ex = (kind: string, more: Partial<GridInput['exceptions'][number]> = {}) => ({ doctorId: D1, localDate: '2026-06-10', kind, clinicId: null, startLocal: null, endLocal: null, breakStartLocal: null, breakEndLocal: null, ...more });
    for (const kind of ['vacation', 'sick', 'day_off']) expect(computeSlots(base({ exceptions: [ex(kind)] })), kind).toEqual([]);
    const custom = computeSlots(base({ exceptions: [ex('custom_hours', { clinicId: CLINIC, startLocal: '10:00', endLocal: '12:00' })] }));
    expect(times(custom)).toEqual(['10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30']);
    // extra day on a Thursday (no template that weekday)
    const thu = computeSlots(base({ fromDate: '2026-06-11', exceptions: [ex('extra_day', { localDate: '2026-06-11', clinicId: CLINIC, startLocal: '10:00', endLocal: '11:00' })] }));
    expect(times(thu)).toEqual(['10:00', '10:15', '10:30']);
  });

  it('an extra day in ANOTHER clinic means the doctor is not here that day', () => {
    const e = { doctorId: D1, localDate: '2026-06-10', kind: 'extra_day', clinicId: 'elsewhere', startLocal: '10:00', endLocal: '12:00', breakStartLocal: null, breakEndLocal: null };
    expect(computeSlots(base({ exceptions: [e] }))).toEqual([]);
  });

  it('ultrasound services also respect the room, others do not', () => {
    const room = [{ startsAt: at('2026-06-10', '10:00'), occupiedUntil: at('2026-06-10', '10:35') }];
    const uzi = times(computeSlots(base({ needsUltrasound: true, roomBusy: room })));
    expect(uzi).not.toContain('10:00');
    expect(uzi).not.toContain('09:30');
    expect(uzi).toContain('10:45');
    expect(times(computeSlots(base({ needsUltrasound: false, roomBusy: room })))).toContain('10:00');
  });

  it('several doctors are independent and ordered per day', () => {
    const slots = computeSlots(base({ doctorIds: ['d1', 'd2'], templates: [tpl(), tpl({ doctorId: 'd2', startLocal: '10:00', endLocal: '11:00', breakStartLocal: null, breakEndLocal: null })] }));
    expect(slots.filter((s) => s.doctorId === 'd2').map((s) => s.localTime)).toEqual(['10:00', '10:15', '10:30']);
    expect(slots.filter((s) => s.doctorId === 'd1')).toHaveLength(26);
  });

  it('does not mutate its input and is deterministic', () => {
    const input = base({ doctorBusy: [{ doctorId: D1, startsAt: at('2026-06-10', '10:00'), occupiedUntil: at('2026-06-10', '10:35') }] });
    const snapshot = JSON.stringify(input);
    const a = computeSlots(input);
    const b = computeSlots(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('grid on the nights the clocks change (invariant 11)', () => {
  const dayFor = (date: string) => ({ weekday: isoWeekday(date) });
  it('Kyiv spring-forward 2026-03-29: a normal 09:00 shift is not shifted by an hour', () => {
    const s = computeSlots(base({ fromDate: '2026-03-29', now: new Date('2026-03-01T00:00:00Z'), templates: [tpl(dayFor('2026-03-29'))] }));
    expect(s[0]?.localTime).toBe('09:00');
    expect(s[0]?.startsAt.toISOString()).toBe('2026-03-29T06:00:00.000Z'); // 09:00 at UTC+3
    const prev = computeSlots(base({ fromDate: '2026-03-28', now: new Date('2026-03-01T00:00:00Z'), templates: [tpl(dayFor('2026-03-28'))] }));
    expect(prev[0]?.startsAt.toISOString()).toBe('2026-03-28T07:00:00.000Z'); // 09:00 at UTC+2
    expect(s).toHaveLength(prev.length);
  });
  it('a night shift across the gap skips the hour that does not exist and shows no duplicates', () => {
    const s = computeSlots(base({ fromDate: '2026-03-29', now: new Date('2026-03-01T00:00:00Z'), durationMin: 15, templates: [tpl({ ...dayFor('2026-03-29'), startLocal: '02:00', endLocal: '05:00', breakStartLocal: null, breakEndLocal: null })] }));
    expect(times(s)).toEqual(['02:00', '02:15', '02:30', '02:45', '04:00', '04:15', '04:30', '04:45']); // 03:xx does not exist
    expect(new Set(s.map((x) => x.startsAt.getTime())).size).toBe(s.length);
    const sorted = [...s].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    expect(s).toEqual(sorted);
  });
  it('Warsaw spring-forward: 02:00–03:00 does not exist', () => {
    const s = computeSlots(base({ timeZone: 'Europe/Warsaw', fromDate: '2026-03-29', now: new Date('2026-03-01T00:00:00Z'), durationMin: 15, templates: [tpl({ ...dayFor('2026-03-29'), startLocal: '01:00', endLocal: '04:00', breakStartLocal: null, breakEndLocal: null })] }));
    expect(times(s)).toEqual(['01:00', '01:15', '01:30', '01:45', '03:00', '03:15', '03:30', '03:45']);
  });
  it('fall-back 2026-10-25: the repeated hour is offered once, at its first occurrence, and instants stay increasing', () => {
    const s = computeSlots(base({ fromDate: '2026-10-25', now: new Date('2026-10-01T00:00:00Z'), durationMin: 15, templates: [tpl({ ...dayFor('2026-10-25'), startLocal: '02:00', endLocal: '05:00', breakStartLocal: null, breakEndLocal: null })] }));
    expect(times(s)).toEqual(['02:00', '02:15', '02:30', '02:45', '03:00', '03:15', '03:30', '03:45', '04:00', '04:15', '04:30', '04:45']);
    const at0300 = s.find((x) => x.localTime === '03:00');
    expect(at0300?.startsAt.toISOString()).toBe('2026-10-25T00:00:00.000Z'); // first 03:00, still UTC+3
    expect(new Set(s.map((x) => x.startsAt.getTime())).size).toBe(s.length);
  });
  it('a normal daytime shift on fall-back day starts at 09:00 local = 07:00Z (UTC+2)', () => {
    const s = computeSlots(base({ fromDate: '2026-10-25', now: new Date('2026-10-01T00:00:00Z'), templates: [tpl(dayFor('2026-10-25'))] }));
    expect(s[0]?.startsAt.toISOString()).toBe('2026-10-25T07:00:00.000Z');
  });
  it('whatever the viewer zone: slots are instants labelled with the clinic wall clock', () => {
    const s = computeSlots(base({ timeZone: 'Europe/Warsaw', fromDate: '2026-06-10', templates: [tpl()] }));
    expect(s[0]?.localTime).toBe('09:00');
    expect(s[0]?.startsAt.toISOString()).toBe('2026-06-10T07:00:00.000Z');
    expect(instantToLocal(s[0]?.startsAt as Date, 'America/New_York').time).toBe('03:00'); // a New Yorker sees 03:00, books Warsaw 09:00
  });
});

// A deliberately naive implementation, written independently, used as an oracle.
const oracle = (i: GridInput): string[] => {
  const out: string[] = [];
  for (let d = 0; d < i.days; d++) {
    const date = addDays(i.fromDate, d);
    for (const doc of i.doctorIds) {
      const ex = i.exceptions.find((e) => e.doctorId === doc && e.localDate === date);
      let hrs: [number, number, number | null, number | null] | null = null;
      if (ex) {
        if ((ex.kind === 'extra_day' || ex.kind === 'custom_hours') && ex.clinicId === i.clinicId && ex.startLocal && ex.endLocal)
          hrs = [minutesOfTime(ex.startLocal), minutesOfTime(ex.endLocal), null, null];
      } else {
        const t = i.templates.find((x) => x.doctorId === doc && x.weekday === isoWeekday(date));
        if (t) hrs = [minutesOfTime(t.startLocal), minutesOfTime(t.endLocal), t.breakStartLocal ? minutesOfTime(t.breakStartLocal) : null, t.breakEndLocal ? minutesOfTime(t.breakEndLocal) : null];
      }
      if (!hrs) continue;
      for (let m = 0; m < 24 * 60; m += 15) {
        const end = m + i.durationMin;
        if (m < hrs[0] || end > hrs[1]) continue;
        if (hrs[2] !== null && hrs[3] !== null && m < hrs[3] && end > hrs[2]) continue;
        const r = localToInstant(date, timeOfMinutes(m), i.timeZone, 'earlier');
        if (!r.ok) continue;
        const s = r.value.getTime();
        if (s < i.now.getTime() + i.minLeadMinutes * MIN || s > i.now.getTime() + i.maxAdvanceDays * 86_400_000) continue;
        const e = s + (i.durationMin + i.prepMinutes) * MIN;
        if (i.doctorBusy.some((b) => b.doctorId === doc && b.startsAt.getTime() < e && b.occupiedUntil.getTime() > s)) continue;
        if (i.needsUltrasound && i.roomBusy.some((b) => b.startsAt.getTime() < e && b.occupiedUntil.getTime() > s)) continue;
        out.push(`${doc}|${s}`);
      }
    }
  }
  return out;
};

describe('grid vs a naive oracle (random inputs, including DST days)', () => {
  const tz = fc.constantFrom('Europe/Kyiv', 'Europe/Warsaw');
  const from = fc.constantFrom('2026-03-26', '2026-03-28', '2026-10-23', '2026-10-24', '2026-06-08', '2026-12-30');
  const hhmm = fc.integer({ min: 0, max: 95 }).map((q) => timeOfMinutes(q * 15 === 1440 ? 1425 : q * 15));
  const template = fc.record({ weekday: fc.integer({ min: 1, max: 7 }), a: hhmm, b: hhmm, c: hhmm, d: hhmm, withBreak: fc.boolean() }).map((r) => {
    const [s, e] = [r.a, r.b].sort();
    const [bs, be] = [r.c, r.d].sort();
    const hasBreak = r.withBreak && (s as string) <= (bs as string) && (bs as string) < (be as string) && (be as string) <= (e as string);
    return { doctorId: D1, weekday: r.weekday, startLocal: s as string, endLocal: e as string, breakStartLocal: hasBreak ? (bs as string) : null, breakEndLocal: hasBreak ? (be as string) : null };
  }).filter((t) => t.startLocal < t.endLocal);

  it('same slots as the oracle', () => {
    fc.assert(
      fc.property(
        tz, from, fc.array(template, { minLength: 1, maxLength: 7 }), fc.constantFrom(15, 30, 45, 60, 90), fc.boolean(),
        fc.array(fc.record({ off: fc.integer({ min: 0, max: 6 * 24 * 60 }), len: fc.integer({ min: 15, max: 120 }) }), { maxLength: 12 }),
        fc.integer({ min: 0, max: 7 * 24 * 60 }),
        (timeZone, fromDate, templates, durationMin, uzi, busyRaw, nowOff) => {
          const start = new Date('2026-03-20T00:00:00Z').getTime();
          const dedup = new Map(templates.map((t) => [t.weekday, t]));
          const busy = busyRaw.map((b) => ({ doctorId: D1, startsAt: new Date(start + b.off * MIN), occupiedUntil: new Date(start + (b.off + b.len) * MIN) }));
          const input = base({
            timeZone, fromDate, days: 3, durationMin, needsUltrasound: uzi, templates: [...dedup.values()],
            doctorBusy: uzi ? [] : busy, roomBusy: uzi ? busy : [], now: new Date(start + nowOff * MIN), maxAdvanceDays: 400,
          });
          const got = computeSlots(input).map((s) => `${s.doctorId}|${s.startsAt.getTime()}`);
          const want = oracle(input);
          expect(got.sort()).toEqual(want.sort());
        },
      ),
      { numRuns: 400 },
    );
  });

  it('adding busy time never creates slots; every slot satisfies the hard rules', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ off: fc.integer({ min: 0, max: 14 * 24 * 60 }), len: fc.integer({ min: 15, max: 100 }) }), { maxLength: 30 }), fc.integer({ min: 0, max: 29 }), (raw, cut) => {
        const start = new Date('2026-06-08T00:00:00Z').getTime();
        const mk = (n: number) => raw.slice(0, n).map((b) => ({ doctorId: D1, startsAt: new Date(start + b.off * MIN), occupiedUntil: new Date(start + (b.off + b.len) * MIN) }));
        const days = { days: 14, fromDate: '2026-06-08', templates: [1, 2, 3, 4, 5].map((weekday) => tpl({ weekday })) };
        const few = computeSlots(base({ ...days, doctorBusy: mk(cut) })).map((s) => s.startsAt.getTime());
        const many = computeSlots(base({ ...days, doctorBusy: mk(30) }));
        const fewSet = new Set(few);
        for (const s of many) {
          expect(fewSet.has(s.startsAt.getTime())).toBe(true);
          const e = s.startsAt.getTime() + 35 * MIN;
          for (const b of mk(30)) expect(b.startsAt.getTime() < e && b.occupiedUntil.getTime() > s.startsAt.getTime()).toBe(false);
          expect(s.endsAt.getTime() - s.startsAt.getTime()).toBe(30 * MIN);
        }
      }),
      { numRuns: 200 },
    );
  });
});
