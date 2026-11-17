import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  joinWaitlistSchema,
  signUpSchema,
  holdSlotSchema,
  scheduleTemplateSchema,
  phoneSchema,
  localDateSchema,
  reportPeriodSchema,
  confirmBookingSchema,
  scheduleExceptionSchema,
} from '../src/index.js';

const uuid = '0190c0de-0000-7000-8000-000000000001';

describe('schemas reject hostile input without throwing', () => {
  const nasty = fc.anything({ withNullPrototype: true, withBigInt: true, withDate: true });
  for (const [name, schema] of Object.entries({
    signUpSchema,
    holdSlotSchema,
    joinWaitlistSchema,
    scheduleTemplateSchema,
    reportPeriodSchema,
    confirmBookingSchema,
    scheduleExceptionSchema,
  })) {
    it(`${name}: arbitrary values never throw`, () => {
      fc.assert(fc.property(nasty, (v) => { schema.safeParse(v); }), { numRuns: 500 });
    });
  }
  it('prototype pollution keys are ignored', () => {
    const r = confirmBookingSchema.safeParse(JSON.parse(`{"__proto__":{"admin":true},"appointmentId":"${uuid}","idempotencyKey":"abcdefgh"}`));
    expect(r.success).toBe(true);
    expect(({} as Record<string, unknown>)['admin']).toBeUndefined();
  });
});

describe('dates', () => {
  it('rejects impossible calendar dates', () => {
    for (const d of ['2026-02-30', '2026-13-01', '2026-00-10', '26-01-01', '2026-1-1', '', "2026-01-01'; DROP"]) {
      expect(localDateSchema.safeParse(d).success).toBe(false);
    }
    expect(localDateSchema.safeParse('2028-02-29').success).toBe(true);
    expect(localDateSchema.safeParse('2027-02-29').success).toBe(false);
  });
});

describe('holdSlot', () => {
  const base = { clinicId: uuid, doctorId: uuid, serviceId: uuid };
  it('needs an offset in the timestamp (no browser-local ambiguity)', () => {
    expect(holdSlotSchema.safeParse({ ...base, startsAt: '2026-06-10T09:00:00' }).success).toBe(false);
    expect(holdSlotSchema.safeParse({ ...base, startsAt: '2026-06-10T09:00:00+02:00' }).success).toBe(true);
  });
  it('rejects non-uuid ids', () => {
    expect(holdSlotSchema.safeParse({ ...base, doctorId: '1 OR 1=1', startsAt: '2026-06-10T09:00:00Z' }).success).toBe(false);
  });
});

describe('waitlist range', () => {
  const b = { doctorId: uuid, serviceId: uuid };
  it('rejects reversed and too long ranges', () => {
    expect(joinWaitlistSchema.safeParse({ ...b, fromDate: '2026-06-10', toDate: '2026-06-09' }).success).toBe(false);
    expect(joinWaitlistSchema.safeParse({ ...b, fromDate: '2026-06-01', toDate: '2026-09-01' }).success).toBe(false);
    expect(joinWaitlistSchema.safeParse({ ...b, fromDate: '2026-06-01', toDate: '2026-06-10' }).success).toBe(true);
  });
});

describe('schedule template', () => {
  const t = { doctorId: uuid, clinicId: uuid, weekday: 1, startLocal: '09:00', endLocal: '17:00' };
  it('accepts a normal template', () => {
    expect(scheduleTemplateSchema.safeParse({ ...t, breakStartLocal: '13:00', breakEndLocal: '14:00' }).success).toBe(true);
  });
  it('rejects break outside hours, half a break, misaligned times, bad weekday', () => {
    expect(scheduleTemplateSchema.safeParse({ ...t, breakStartLocal: '08:00', breakEndLocal: '09:00' }).success).toBe(false);
    expect(scheduleTemplateSchema.safeParse({ ...t, breakStartLocal: '13:00' }).success).toBe(false);
    expect(scheduleTemplateSchema.safeParse({ ...t, startLocal: '09:07' }).success).toBe(false);
    expect(scheduleTemplateSchema.safeParse({ ...t, weekday: 8 }).success).toBe(false);
    expect(scheduleTemplateSchema.safeParse({ ...t, startLocal: '18:00' }).success).toBe(false);
  });
});

describe('phone', () => {
  it('normalizes and validates', () => {
    expect(phoneSchema.parse('+380 (50) 123-45-67')).toBe('+380501234567');
    expect(phoneSchema.safeParse('0501234567').success).toBe(false);
    expect(phoneSchema.safeParse('+38050abc').success).toBe(false);
  });
});

describe('signUp', () => {
  it('normalizes email, rejects weak password', () => {
    const ok = signUpSchema.safeParse({ email: '  USER@Example.COM ', password: 'longenoughpass', fullName: 'Іван Петренко', phone: '+380501234567' });
    expect(ok.success && ok.data.email).toBe('user@example.com');
    expect(signUpSchema.safeParse({ email: 'a@b.co', password: 'short', fullName: 'Іван', phone: '+380501234567' }).success).toBe(false);
  });
  it('caps password length (argon2 DoS guard)', () => {
    expect(signUpSchema.safeParse({ email: 'a@b.co', password: 'x'.repeat(100_000), fullName: 'Іван', phone: '+380501234567' }).success).toBe(false);
  });
});

describe('report period', () => {
  it('limits the span', () => {
    expect(reportPeriodSchema.safeParse({ from: '2026-01-01', to: '2026-03-31' }).success).toBe(true);
    expect(reportPeriodSchema.safeParse({ from: '2020-01-01', to: '2026-03-31' }).success).toBe(false);
  });
});
