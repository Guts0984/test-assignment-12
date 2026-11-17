import { describe, expect, it } from 'vitest';
import {
  formatAppointmentsCount,
  formatMoney,
  formatDateTime,
  pluralize,
  localToInstant,
} from '../src/index.js';

const norm = (s: string): string => s.replace(/[\u00a0\u202f]/g, ' ');

describe('money', () => {
  it('uk: 1 234,50 ₴', () => expect(norm(formatMoney(123450, 'UAH', 'uk'))).toBe('1 234,50 ₴'));
  it('pl: 1 234,50 zł (grouping forced for 4 digits)', () =>
    expect(norm(formatMoney(123450, 'PLN', 'pl'))).toBe('1 234,50 zł'));
  it('en uses English separators and still the clinic currency', () => {
    expect(formatMoney(123450, 'UAH', 'en')).toContain('1,234.50');
    expect(formatMoney(123450, 'UAH', 'en')).toContain('₴');
    expect(formatMoney(123450, 'PLN', 'en')).toContain('zł');
  });
  it('whole and tiny amounts', () => {
    expect(norm(formatMoney(0, 'UAH', 'uk'))).toBe('0,00 ₴');
    expect(norm(formatMoney(5, 'PLN', 'pl'))).toBe('0,05 zł');
    expect(norm(formatMoney(100000000, 'PLN', 'pl'))).toBe('1 000 000,00 zł');
  });
  it('rejects non-integer minor units (money is integers)', () => {
    expect(() => formatMoney(10.5, 'UAH', 'uk')).toThrow(RangeError);
    expect(() => formatMoney(Number.NaN, 'UAH', 'uk')).toThrow(RangeError);
  });
});

describe('plurals', () => {
  it('uk', () => {
    expect(formatAppointmentsCount('uk', 1)).toBe('1 запис');
    expect(formatAppointmentsCount('uk', 3)).toBe('3 записи');
    expect(formatAppointmentsCount('uk', 5)).toBe('5 записів');
    expect(formatAppointmentsCount('uk', 11)).toBe('11 записів');
    expect(formatAppointmentsCount('uk', 21)).toBe('21 запис');
    expect(formatAppointmentsCount('uk', 22)).toBe('22 записи');
  });
  it('pl', () => {
    expect(formatAppointmentsCount('pl', 1)).toBe('1 wizyta');
    expect(formatAppointmentsCount('pl', 3)).toBe('3 wizyty');
    expect(formatAppointmentsCount('pl', 5)).toBe('5 wizyt');
    expect(formatAppointmentsCount('pl', 12)).toBe('12 wizyt');
    expect(formatAppointmentsCount('pl', 22)).toBe('22 wizyty');
  });
  it('en', () => {
    expect(formatAppointmentsCount('en', 1)).toBe('1 appointment');
    expect(formatAppointmentsCount('en', 0)).toBe('0 appointments');
    expect(formatAppointmentsCount('en', 2)).toBe('2 appointments');
  });
  it('falls back to other when a category is missing', () => {
    expect(pluralize('en', 2, { one: 'a', other: 'b' })).toBe('2 b');
  });
});

describe('dates are rendered in the clinic zone, not the process zone', () => {
  it('same instant, different clinics', () => {
    const t = new Date('2026-06-10T07:00:00Z');
    expect(formatDateTime(t, 'Europe/Warsaw', 'en')).toContain('09:00');
    expect(formatDateTime(t, 'Europe/Kyiv', 'en')).toContain('10:00');
    expect(formatDateTime(t, 'America/New_York', 'en')).toContain('03:00');
  });
  it('visit on a DST night keeps the wall time', () => {
    const r = localToInstant('2026-03-29', '04:00', 'Europe/Kyiv');
    expect(r.ok && formatDateTime(r.value, 'Europe/Kyiv', 'en')).toContain('04:00');
  });
});
