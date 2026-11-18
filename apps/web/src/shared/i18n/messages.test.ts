import { describe, expect, it } from 'vitest';
import uk from '../../../messages/uk.json';
import en from '../../../messages/en.json';
import pl from '../../../messages/pl.json';
import { formatAppointmentsCount, formatMoney } from '@clinic/shared';

const flat = (o: Record<string, unknown>, prefix = ''): Record<string, string> =>
  Object.fromEntries(
    Object.entries(o).flatMap(([k, v]) =>
      typeof v === 'object' && v
        ? Object.entries(flat(v as Record<string, unknown>, `${prefix}${k}.`))
        : [[`${prefix}${k}`, String(v)]],
    ),
  );

const U = flat(uk);
const E = flat(en);
const P = flat(pl);
const params = (s: string): string[] =>
  [...s.matchAll(/\{(\w+)\s*[,}]/g)].map((m) => m[1] as string).sort();

describe('translations', () => {
  it('every key exists in all three languages', () => {
    expect(Object.keys(E).sort()).toEqual(Object.keys(U).sort());
    expect(Object.keys(P).sort()).toEqual(Object.keys(U).sort());
  });
  it('no empty strings; placeholders match across languages', () => {
    for (const k of Object.keys(U)) {
      for (const L of [U, E, P]) expect(L[k]?.trim(), k).toBeTruthy();
      expect(params(E[k] as string), k).toEqual(params(U[k] as string));
      expect(params(P[k] as string), k).toEqual(params(U[k] as string));
    }
  });
  it('every API error code has a message in every language', () => {
    for (const code of [
      'SLOT_TAKEN',
      'HOLD_EXPIRED',
      'FUTURE_LIMIT_REACHED',
      'RATE_LIMITED',
      'INTERNAL_SERVER_ERROR',
      'ONLINE_BOOKING_BLOCKED',
      'OFFER_EXPIRED',
      'network',
    ]) {
      for (const L of [U, E, P]) expect(L[`errors.${code}`], code).toBeTruthy();
    }
  });
  it("plural messages use each language's categories (uk/pl have few and many)", () => {
    expect(U['cabinet.count']).toMatch(/few.*many/);
    expect(P['cabinet.count']).toMatch(/few.*many/);
    expect(E['cabinet.count']).not.toMatch(/few/);
  });
  it('the shared formatters give the spec examples', () => {
    const n = (s: string) => s.replace(new RegExp('[\\u00a0\\u202f]', 'g'), ' ');
    expect(n(formatMoney(123450, 'UAH', 'uk'))).toBe('1 234,50 ₴');
    expect(n(formatMoney(123450, 'PLN', 'pl'))).toBe('1 234,50 zł');
    expect(formatAppointmentsCount('uk', 3)).toBe('3 записи');
    expect(formatAppointmentsCount('pl', 5)).toBe('5 wizyt');
  });
});
