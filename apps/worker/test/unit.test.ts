import { describe, expect, it } from 'vitest';
import { escapeHtml, isSendableEmail, loadWorkerEnv, renderMail } from '../src/index.js';
import type { AppointmentView } from '../src/view.js';

const SPACES = new RegExp('[\\u00a0\\u202f]', 'g');
const view = (over: Partial<AppointmentView> = {}): AppointmentView => ({
  id: 'a', status: 'booked', version: 1, startsAt: new Date('2026-06-10T07:00:00Z'), endsAt: new Date('2026-06-10T07:30:00Z'),
  clinicId: 'c', doctorId: 'd', localDate: '2026-06-10', patientId: 'p', patientName: 'Іван', patientEmail: 'i@x.io', patientUserId: null,
  locale: 'uk', doctorName: 'Др. Коваль', serviceNames: { uk: 'Консультація', en: 'Consultation', pl: 'Konsultacja' }, clinicCity: 'Варшава',
  timeZone: 'Europe/Warsaw', currency: 'PLN', priceMinor: 123450, ...over,
});

describe('email templates', () => {
  it('times are in the clinic zone and prices in the clinic currency, in every language', () => {
    const uk = renderMail(view(), { kind: 'reminder', hours: 24 });
    expect(uk.subject).toContain('09:00'); // 07:00Z is 09:00 in Warsaw in June
    expect(uk.text.replace(SPACES, ' ')).toContain('1 234,50 zł');
    const en = renderMail(view({ locale: 'en' }), { kind: 'booking_confirmed' });
    expect(en.subject).toMatch(/confirmed/i);
    expect(en.text).toContain('Consultation');
    expect(en.text).toContain('1,234.50');
    const pl = renderMail(view({ locale: 'pl' }), { kind: 'sick_cancel' });
    expect(pl.subject).toContain('lekarz jest chory');
    expect(pl.text.replace(SPACES, ' ')).toContain('1 234,50 zł');
  });
  it('every kind renders in every locale without leftovers', () => {
    for (const locale of ['uk', 'en', 'pl'] as const)
      for (const k of [{ kind: 'reminder', hours: 24 }, { kind: 'reminder', hours: 2 }, { kind: 'booking_confirmed' }, { kind: 'cancelled' }, { kind: 'sick_cancel' }, { kind: 'waitlist_offer', expiresAt: new Date('2026-06-10T08:00:00Z') }] as const) {
        const m = renderMail(view({ locale }), k);
        expect(m.subject.length).toBeGreaterThan(5);
        for (const part of [m.subject, m.text, m.html]) expect(part).not.toMatch(/undefined|\[object|NaN/);
      }
  });
  it('a DST-night visit is shown at its wall-clock time', () => {
    const m = renderMail(view({ locale: 'en', timeZone: 'Europe/Kyiv', startsAt: new Date('2026-03-29T01:00:00Z') }), { kind: 'reminder', hours: 2 });
    expect(m.subject).toContain('04:00'); // 01:00Z = 04:00 EEST after the jump, not 03:00
  });
  it('subjects are single-line even when data is hostile; html is escaped', () => {
    const m = renderMail(view({ patientName: 'x\r\nBcc: a@b.c', doctorName: '<img src=x onerror=alert(1)>' }), { kind: 'cancelled' });
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.html).not.toContain('<img');
    expect(m.html).toContain('&lt;img');
  });
  it('escapeHtml covers the five characters', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
  it('only plain addresses are mailed', () => {
    for (const ok of ['a@b.io', 'first.last+tag@sub.example.com']) expect(isSendableEmail(ok), ok).toBe(true);
    for (const bad of [null, '', 'a@b', 'a b@c.io', 'a@b.io\r\nBcc: x@y.z', '<a@b.io>', 'a@b.io, c@d.io', 'a@b.io;c@d.io', `${'x'.repeat(250)}@b.io`]) expect(isSendableEmail(bad), String(bad)).toBe(false);
  });
});

describe('worker env', () => {
  it('fails fast without the database url; has safe defaults for the rest', () => {
    expect(() => loadWorkerEnv({})).toThrow(/DATABASE_URL/);
    const e = loadWorkerEnv({ DATABASE_URL: 'postgres://x' });
    expect(e).toMatchObject({ REDIS_URL: 'redis://localhost:6379', SMTP_PORT: 1025, WORKER_CONCURRENCY: 5, WORKER_RECONCILE_MS: 15000, HOLD_TTL_SECONDS: 600, OFFER_TTL_SECONDS: 900, WORKER_PROCESSING_DELAY_MS: 0 });
  });
  it('rejects nonsense', () => {
    expect(() => loadWorkerEnv({ DATABASE_URL: 'x', WORKER_CONCURRENCY: '0' })).toThrow(/WORKER_CONCURRENCY/);
    expect(() => loadWorkerEnv({ DATABASE_URL: 'x', SMTP_PORT: 'abc' })).toThrow(/SMTP_PORT/);
    expect(() => loadWorkerEnv({ DATABASE_URL: 'x', HOLD_TTL_SECONDS: '-5' })).toThrow(/HOLD_TTL_SECONDS/);
  });
});
