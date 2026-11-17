import { z } from 'zod';

export const SLOT_STEP_MINUTES = 15;
export const MIN_SERVICE_MINUTES = 15;
export const MAX_SERVICE_MINUTES = 90;
export const AVAILABILITY_DAYS = 14;
export const MAX_FUTURE_APPOINTMENTS = 3;
export const FREE_CANCEL_HOURS = 24;
export const PENALTY_THRESHOLD = 2;
export const PENALTY_WINDOW_DAYS = 90;
export const ONLINE_BLOCK_DAYS = 30;
export const REMINDER_HOURS = [24, 2] as const;
export const MAX_ACTIVE_WAITLIST_ENTRIES = 5;
export const MAX_WAITLIST_RANGE_DAYS = 60;
export const CHECK_IN_OPENS_MINUTES_BEFORE = 30;

export const LOCALES = ['uk', 'en', 'pl'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'uk';

export const CURRENCIES = ['UAH', 'PLN'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const ROLES = ['patient', 'registrar', 'doctor', 'manager'] as const;
export type Role = (typeof ROLES)[number];

export const APPOINTMENT_STATUSES = [
  'held',
  'booked',
  'checked_in',
  'completed',
  'no_show',
  'cancelled',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Statuses that occupy the doctor / room / patient time (everything except cancelled). */
export const ACTIVE_STATUSES: readonly AppointmentStatus[] = [
  'held',
  'booked',
  'checked_in',
  'completed',
  'no_show',
];

export const CLINIC_DEFS = [
  { code: 'kyiv', city: 'Київ', timeZone: 'Europe/Kyiv', currency: 'UAH' },
  { code: 'lviv', city: 'Львів', timeZone: 'Europe/Kyiv', currency: 'UAH' },
  { code: 'warsaw', city: 'Варшава', timeZone: 'Europe/Warsaw', currency: 'PLN' },
] as const satisfies readonly {
  code: string;
  city: string;
  timeZone: string;
  currency: Currency;
}[];

/** Tunable rules. Defaults are the assignment values; tests shorten them through env. */
export type Rules = {
  readonly holdTtlSeconds: number;
  readonly offerTtlSeconds: number;
  readonly minLeadMinutes: number;
  readonly maxAdvanceDays: number;
  readonly prepMinutes: number;
};

export const DEFAULT_RULES: Rules = {
  holdTtlSeconds: 600,
  offerTtlSeconds: 900,
  minLeadMinutes: 120,
  maxAdvanceDays: 60,
  prepMinutes: 5,
};

/** Zod shape for the rule env vars; each app's env.ts spreads it into its own schema. */
export const rulesEnvShape = {
  HOLD_TTL_SECONDS: z.coerce.number().int().positive().default(DEFAULT_RULES.holdTtlSeconds),
  OFFER_TTL_SECONDS: z.coerce.number().int().positive().default(DEFAULT_RULES.offerTtlSeconds),
  MIN_LEAD_MINUTES: z.coerce.number().int().min(0).default(DEFAULT_RULES.minLeadMinutes),
  MAX_ADVANCE_DAYS: z.coerce.number().int().positive().default(DEFAULT_RULES.maxAdvanceDays),
  PREP_MINUTES: z.coerce.number().int().min(0).default(DEFAULT_RULES.prepMinutes),
};

export const rulesFromEnv = (e: {
  HOLD_TTL_SECONDS: number;
  OFFER_TTL_SECONDS: number;
  MIN_LEAD_MINUTES: number;
  MAX_ADVANCE_DAYS: number;
  PREP_MINUTES: number;
}): Rules => ({
  holdTtlSeconds: e.HOLD_TTL_SECONDS,
  offerTtlSeconds: e.OFFER_TTL_SECONDS,
  minLeadMinutes: e.MIN_LEAD_MINUTES,
  maxAdvanceDays: e.MAX_ADVANCE_DAYS,
  prepMinutes: e.PREP_MINUTES,
});
