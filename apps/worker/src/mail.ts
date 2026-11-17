import nodemailer from 'nodemailer';
import { formatDateTime, formatMoney, type Locale } from '@clinic/shared';
import type { AppointmentView } from './view.js';

export type MailKind =
  | { kind: 'reminder'; hours: 24 | 2 }
  | { kind: 'booking_confirmed' }
  | { kind: 'cancelled' }
  | { kind: 'sick_cancel' }
  | { kind: 'waitlist_offer'; expiresAt: Date };

export type RenderedMail = { subject: string; text: string; html: string };

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Header values must be one line: CR/LF would let a patient name inject headers. */
const LINE_BREAKS = new RegExp('[\\r\\n\\u2028\\u2029]+', 'g');
const oneLine = (s: string): string => s.replace(LINE_BREAKS, ' ').trim();

type Words = {
  hello: (name: string) => string;
  subject: Record<string, (when: string) => string>;
  intro: Record<string, (when: string) => string>;
  details: (doctor: string, service: string, city: string, price: string) => string;
  offer: (until: string) => string;
  bye: string;
};

const WORDS: Record<Locale, Words> = {
  uk: {
    hello: (n) => `Вітаємо, ${n}!`,
    subject: {
      reminder24: (w) => `Нагадування: прийом завтра, ${w}`,
      reminder2: (w) => `Нагадування: прийом за 2 години, ${w}`,
      booking_confirmed: (w) => `Запис підтверджено на ${w}`,
      cancelled: (w) => `Запис на ${w} скасовано`,
      sick_cancel: (w) => `Прийом ${w} скасовано: лікар хворіє`,
      waitlist_offer: (w) => `Звільнився час: ${w}`,
    },
    intro: {
      reminder24: (w) => `Нагадуємо про прийом ${w}.`,
      reminder2: (w) => `Через 2 години у вас прийом: ${w}.`,
      booking_confirmed: (w) => `Ваш запис підтверджено: ${w}.`,
      cancelled: (w) => `Запис на ${w} скасовано.`,
      sick_cancel: (w) => `На жаль, лікар захворів, тому прийом ${w} скасовано. Ми поставили вас першим у листі очікування до цього лікаря.`,
      waitlist_offer: (w) => `Для вас звільнився час: ${w}.`,
    },
    details: (d, s, c, p) => `Лікар: ${d}\nПослуга: ${s}\nМісто: ${c}\nВартість: ${p}`,
    offer: (u) => `Час закріплено за вами до ${u}. Підтвердьте його в особистому кабінеті.`,
    bye: 'З повагою, мережа клінік',
  },
  en: {
    hello: (n) => `Hello, ${n}!`,
    subject: {
      reminder24: (w) => `Reminder: your appointment tomorrow, ${w}`,
      reminder2: (w) => `Reminder: your appointment in 2 hours, ${w}`,
      booking_confirmed: (w) => `Appointment confirmed for ${w}`,
      cancelled: (w) => `Appointment on ${w} cancelled`,
      sick_cancel: (w) => `Appointment ${w} cancelled: the doctor is ill`,
      waitlist_offer: (w) => `A time has become free: ${w}`,
    },
    intro: {
      reminder24: (w) => `A reminder about your appointment on ${w}.`,
      reminder2: (w) => `Your appointment is in 2 hours: ${w}.`,
      booking_confirmed: (w) => `Your appointment is confirmed: ${w}.`,
      cancelled: (w) => `Your appointment on ${w} has been cancelled.`,
      sick_cancel: (w) => `Unfortunately the doctor is ill, so your appointment on ${w} was cancelled. You are first in the doctor's waiting list.`,
      waitlist_offer: (w) => `A time you were waiting for is free: ${w}.`,
    },
    details: (d, s, c, p) => `Doctor: ${d}\nService: ${s}\nCity: ${c}\nPrice: ${p}`,
    offer: (u) => `It is held for you until ${u}. Confirm it in your account.`,
    bye: 'Kind regards, the clinic network',
  },
  pl: {
    hello: (n) => `Witaj, ${n}!`,
    subject: {
      reminder24: (w) => `Przypomnienie: wizyta jutro, ${w}`,
      reminder2: (w) => `Przypomnienie: wizyta za 2 godziny, ${w}`,
      booking_confirmed: (w) => `Wizyta potwierdzona na ${w}`,
      cancelled: (w) => `Wizyta ${w} odwołana`,
      sick_cancel: (w) => `Wizyta ${w} odwołana: lekarz jest chory`,
      waitlist_offer: (w) => `Zwolnił się termin: ${w}`,
    },
    intro: {
      reminder24: (w) => `Przypominamy o wizycie ${w}.`,
      reminder2: (w) => `Za 2 godziny masz wizytę: ${w}.`,
      booking_confirmed: (w) => `Twoja wizyta jest potwierdzona: ${w}.`,
      cancelled: (w) => `Wizyta ${w} została odwołana.`,
      sick_cancel: (w) => `Niestety lekarz zachorował, dlatego wizyta ${w} została odwołana. Jesteś pierwszy na liście oczekujących do tego lekarza.`,
      waitlist_offer: (w) => `Zwolnił się termin, na który czekałeś: ${w}.`,
    },
    details: (d, s, c, p) => `Lekarz: ${d}\nUsługa: ${s}\nMiasto: ${c}\nCena: ${p}`,
    offer: (u) => `Termin jest dla Ciebie zarezerwowany do ${u}. Potwierdź go w swoim koncie.`,
    bye: 'Z poważaniem, sieć klinik',
  },
};

/** Subject + text + HTML in the patient's language, with times in the CLINIC's time zone. */
export const renderMail = (v: AppointmentView, k: MailKind): RenderedMail => {
  const w = WORDS[v.locale];
  const when = formatDateTime(v.startsAt, v.timeZone, v.locale);
  const key = k.kind === 'reminder' ? (k.hours === 24 ? 'reminder24' : 'reminder2') : k.kind;
  const price = formatMoney(v.priceMinor, v.currency, v.locale);
  const lines = [
    w.hello(v.patientName),
    '',
    (w.intro[key] as (x: string) => string)(when),
    '',
    w.details(v.doctorName, v.serviceNames[v.locale], v.clinicCity, price),
  ];
  if (k.kind === 'waitlist_offer') lines.push('', w.offer(formatDateTime(k.expiresAt, v.timeZone, v.locale)));
  lines.push('', w.bye);
  const text = lines.join('\n');
  const html = `<!doctype html><html lang="${v.locale}"><body>${lines.map((l) => (l === '' ? '<br>' : `<p>${escapeHtml(l).replace(/\n/g, '<br>')}</p>`)).join('')}</body></html>`;
  return { subject: oneLine((w.subject[key] as (x: string) => string)(when)), text, html };
};

export type Mailer = {
  send: (m: { to: string; messageId: string; mail: RenderedMail }) => Promise<void>;
  close: () => void;
};

export const createMailer = (opts: { host: string; port: number; from: string }): Mailer => {
  const transport = nodemailer.createTransport({
    host: opts.host,
    port: opts.port,
    secure: false,
    ignoreTLS: true,
    pool: true,
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
  });
  return {
    send: async ({ to, messageId, mail }) => {
      await transport.sendMail({
        from: opts.from,
        to, // address only: a hostile display name could never reach a header
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        messageId, // deterministic: the same task always produces the same Message-ID
      });
    },
    close: () => transport.close(),
  };
};

const EMAIL_RE = /^[^\s@<>",;:\\]+@[^\s@<>",;:\\]+\.[^\s@<>",;:\\]+$/;
export const isSendableEmail = (e: string | null): e is string => !!e && e.length <= 254 && EMAIL_RE.test(e);
