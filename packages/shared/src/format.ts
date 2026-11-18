import type { Currency, Locale } from './constants.js';

const INTL_LOCALE: Record<Locale, string> = { uk: 'uk-UA', en: 'en-GB', pl: 'pl-PL' };
export const intlLocale = (l: Locale): string => INTL_LOCALE[l];

/** Minor units (kopiyky / grosze) → localized string in the clinic currency. */
export const formatMoney = (minor: number, currency: Currency, locale: Locale): string => {
  if (!Number.isSafeInteger(minor))
    throw new RangeError('Money must be an integer count of minor units');
  const fmt = new Intl.NumberFormat(INTL_LOCALE[locale], {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    // pl-PL does not group 4-digit numbers by default; the spec wants `1 234,50 zł`
    useGrouping: 'always',
  });
  return fmt.format(minor / 100);
};

export const formatDateTime = (instant: Date, timeZone: string, locale: Locale): string =>
  new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(instant);

export const formatDate = (instant: Date, timeZone: string, locale: Locale): string =>
  new Intl.DateTimeFormat(INTL_LOCALE[locale], { timeZone, dateStyle: 'long' }).format(instant);

export const formatTime = (instant: Date, timeZone: string, locale: Locale): string =>
  new Intl.DateTimeFormat(INTL_LOCALE[locale], { timeZone, timeStyle: 'short' }).format(instant);

export type PluralForms = {
  readonly one: string;
  readonly few?: string;
  readonly many?: string;
  readonly other: string;
};

export const pluralize = (locale: Locale, n: number, forms: PluralForms): string => {
  const cat = new Intl.PluralRules(INTL_LOCALE[locale]).select(n);
  const form = (forms[cat as keyof PluralForms] ?? forms.other) as string;
  return `${n} ${form}`;
};

const APPOINTMENT_FORMS: Record<Locale, PluralForms> = {
  uk: { one: 'запис', few: 'записи', many: 'записів', other: 'запису' },
  en: { one: 'appointment', other: 'appointments' },
  pl: { one: 'wizyta', few: 'wizyty', many: 'wizyt', other: 'wizyty' },
};

export const formatAppointmentsCount = (locale: Locale, n: number): string =>
  pluralize(locale, n, APPOINTMENT_FORMS[locale]);
