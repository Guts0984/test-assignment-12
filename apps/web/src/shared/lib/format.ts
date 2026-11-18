'use client';

import { useLocale } from 'next-intl';
import {
  formatDateTime,
  formatMoney,
  formatTime,
  type Currency,
  type Locale,
} from '@clinic/shared';

/** Money in the CLINIC currency, dates in the CLINIC time zone, in the user's language. */
export const useFormat = () => {
  const locale = useLocale() as Locale;
  return {
    locale,
    money: (minor: number, currency: Currency): string => formatMoney(minor, currency, locale),
    dateTime: (d: Date | string, tz: string): string => formatDateTime(new Date(d), tz, locale),
    time: (d: Date | string, tz: string): string => formatTime(new Date(d), tz, locale),
  };
};

/** Short weekday + day, computed from a calendar date without any time zone conversion. */
export const formatLocalDate = (
  date: string,
  locale: string,
  opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' },
): string =>
  new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  );
