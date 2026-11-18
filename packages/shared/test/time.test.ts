import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  addDays,
  daysBetween,
  instantToLocal,
  isoWeekday,
  localToInstant,
  offsetMinutesAt,
  reminderInstants,
} from '../src/index.js';

const KYIV = 'Europe/Kyiv';
const WARSAW = 'Europe/Warsaw';

const must = (r: ReturnType<typeof localToInstant>): Date => {
  if (!r.ok) throw new Error('expected ok');
  return r.value;
};

describe('offsets', () => {
  it('Kyiv is +2 in winter and +3 in summer; Warsaw is +1 / +2', () => {
    expect(offsetMinutesAt(new Date('2026-01-15T12:00:00Z'), KYIV)).toBe(120);
    expect(offsetMinutesAt(new Date('2026-07-15T12:00:00Z'), KYIV)).toBe(180);
    expect(offsetMinutesAt(new Date('2026-01-15T12:00:00Z'), WARSAW)).toBe(60);
    expect(offsetMinutesAt(new Date('2026-07-15T12:00:00Z'), WARSAW)).toBe(120);
  });
  it('New York viewer does not change the clinic wall time', () => {
    // the same instant formatted in clinic zone is independent of any viewer zone
    const t = must(localToInstant('2026-06-10', '09:00', WARSAW));
    expect(t.toISOString()).toBe('2026-06-10T07:00:00.000Z');
    expect(instantToLocal(t, WARSAW)).toEqual({ date: '2026-06-10', time: '09:00' });
  });
});

describe('spring forward (2026-03-29)', () => {
  it('Kyiv 03:30 does not exist', () => {
    expect(localToInstant('2026-03-29', '03:30', KYIV)).toEqual({
      ok: false,
      error: 'NONEXISTENT_LOCAL_TIME',
    });
  });
  it('Warsaw 02:30 does not exist; 03:00 does', () => {
    expect(localToInstant('2026-03-29', '02:30', WARSAW).ok).toBe(false);
    expect(must(localToInstant('2026-03-29', '03:00', WARSAW)).toISOString()).toBe(
      '2026-03-29T01:00:00.000Z',
    );
  });
  it('the day is only 23h long', () => {
    const a = must(localToInstant('2026-03-29', '00:00', KYIV));
    const b = must(localToInstant('2026-03-30', '00:00', KYIV));
    expect((b.getTime() - a.getTime()) / 3_600_000).toBe(23);
  });
});

describe('fall back (2026-10-25)', () => {
  it('Kyiv 03:30 is ambiguous: earlier = +3, later = +2', () => {
    const e = must(localToInstant('2026-10-25', '03:30', KYIV, 'earlier'));
    const l = must(localToInstant('2026-10-25', '03:30', KYIV, 'later'));
    expect(e.toISOString()).toBe('2026-10-25T00:30:00.000Z');
    expect(l.toISOString()).toBe('2026-10-25T01:30:00.000Z');
  });
  it('the day is 25h long', () => {
    const a = must(localToInstant('2026-10-25', '00:00', WARSAW));
    const b = must(localToInstant('2026-10-26', '00:00', WARSAW));
    expect((b.getTime() - a.getTime()) / 3_600_000).toBe(25);
  });
});

describe('reminders', () => {
  it('24h reminder keeps the clinic wall time across spring-forward', () => {
    // visit Sun 29 Mar 10:00 Kyiv; Saturday 10:00 is only 23 real hours earlier.
    const start = must(localToInstant('2026-03-29', '10:00', KYIV));
    const { h24, h2 } = reminderInstants(start, KYIV);
    expect(instantToLocal(h24, KYIV)).toEqual({ date: '2026-03-28', time: '10:00' });
    expect(start.getTime() - h24.getTime()).toBe(23 * 3_600_000);
    expect(start.getTime() - h2.getTime()).toBe(2 * 3_600_000);
  });
  it('24h reminder keeps the clinic wall time across fall-back', () => {
    const start = must(localToInstant('2026-10-25', '10:00', WARSAW));
    const { h24 } = reminderInstants(start, WARSAW);
    expect(instantToLocal(h24, WARSAW)).toEqual({ date: '2026-10-24', time: '10:00' });
    expect(start.getTime() - h24.getTime()).toBe(25 * 3_600_000);
  });
  it('falls back to start − 24h when the wall time does not exist on the previous day', () => {
    // visit Monday 02:30 Warsaw is fine, but Sunday 02:30 (previous day) does not exist.
    const start = must(localToInstant('2026-03-30', '02:30', WARSAW));
    const { h24 } = reminderInstants(start, WARSAW);
    expect(start.getTime() - h24.getTime()).toBe(24 * 3_600_000);
  });
  it('outside DST changes it is exactly 24h', () => {
    const start = must(localToInstant('2026-06-10', '10:00', KYIV));
    expect(start.getTime() - reminderInstants(start, KYIV).h24.getTime()).toBe(24 * 3_600_000);
  });
});

describe('properties', () => {
  const tzs = fc.constantFrom(KYIV, WARSAW);
  const dates = fc.integer({ min: 0, max: 800 }).map((n) => addDays('2025-01-01', n));
  const times = fc
    .tuple(fc.integer({ min: 0, max: 23 }), fc.constantFrom(0, 15, 30, 45))
    .map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);

  it('local → instant → local round-trips whenever the time exists', () => {
    fc.assert(
      fc.property(dates, times, tzs, (d, t, tz) => {
        const r = localToInstant(d, t, tz);
        if (r.ok) expect(instantToLocal(r.value, tz)).toEqual({ date: d, time: t });
      }),
      { numRuns: 2000 },
    );
  });
  it('a nonexistent time exists only inside the 1h gap', () => {
    fc.assert(
      fc.property(dates, times, tzs, (d, t, tz) => {
        const r = localToInstant(d, t, tz);
        if (!r.ok) {
          const dst = ['2025-03-30', '2026-03-29', '2027-03-28'];
          expect(dst).toContain(d);
        }
      }),
      { numRuns: 2000 },
    );
  });
  it('reminders are always before the start and ordered', () => {
    fc.assert(
      fc.property(dates, times, tzs, (d, t, tz) => {
        const r = localToInstant(d, t, tz);
        if (!r.ok) return;
        const { h24, h2 } = reminderInstants(r.value, tz);
        expect(h24.getTime()).toBeLessThan(h2.getTime());
        expect(h2.getTime()).toBeLessThan(r.value.getTime());
        const gap = (r.value.getTime() - h24.getTime()) / 3_600_000;
        expect([23, 24, 25]).toContain(gap);
      }),
      { numRuns: 2000 },
    );
  });
});

describe('calendar helpers', () => {
  it('addDays crosses month/year/leap boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('daysBetween / isoWeekday', () => {
    expect(daysBetween('2026-01-01', '2026-03-01')).toBe(59);
    expect(isoWeekday('2026-11-16')).toBe(1);
    expect(isoWeekday('2026-11-22')).toBe(7);
  });
});
