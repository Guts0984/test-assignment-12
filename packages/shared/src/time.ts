import { type Result, ok, err } from './result.js';

const MS_MIN = 60_000;
const DAY_MS = 86_400_000;

export type LocalDate = string; // YYYY-MM-DD
export type LocalTime = string; // HH:mm

const dtfCache = new Map<string, Intl.DateTimeFormat>();
const dtf = (tz: string): Intl.DateTimeFormat => {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dtfCache.set(tz, f);
  }
  return f;
};

type Parts = { y: number; mo: number; d: number; h: number; mi: number; s: number };

const partsAt = (ms: number, tz: string): Parts => {
  const out: Record<string, number> = {};
  for (const p of dtf(tz).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    y: out['year'] ?? 0,
    mo: out['month'] ?? 0,
    d: out['day'] ?? 0,
    h: out['hour'] ?? 0,
    mi: out['minute'] ?? 0,
    s: out['second'] ?? 0,
  };
};

/** UTC offset (minutes east of UTC) of `tz` at the given instant. */
export const offsetMinutesAt = (instant: Date, tz: string): number => {
  const ms = instant.getTime();
  const p = partsAt(ms, tz);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / MS_MIN);
};

const pad = (n: number): string => String(n).padStart(2, '0');

export const instantToLocal = (instant: Date, tz: string): { date: LocalDate; time: LocalTime } => {
  const p = partsAt(instant.getTime(), tz);
  return { date: `${p.y}-${pad(p.mo)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
};

export const localDateOf = (instant: Date, tz: string): LocalDate =>
  instantToLocal(instant, tz).date;

const parseDate = (date: LocalDate): [number, number, number] => {
  const [y, m, d] = date.split('-').map(Number);
  return [y ?? 0, m ?? 0, d ?? 0];
};

const parseTime = (time: LocalTime): [number, number] => {
  const [h, m] = time.split(':').map(Number);
  return [h ?? 0, m ?? 0];
};

export const addDays = (date: LocalDate, n: number): LocalDate => {
  const [y, m, d] = parseDate(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};

export const daysBetween = (from: LocalDate, to: LocalDate): number => {
  const [y1, m1, d1] = parseDate(from);
  const [y2, m2, d2] = parseDate(to);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY_MS);
};

/** ISO weekday of a calendar date: 1 = Monday … 7 = Sunday. */
export const isoWeekday = (date: LocalDate): number => {
  const [y, m, d] = parseDate(date);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
};

export type Disambiguation = 'earlier' | 'later';

/**
 * Convert clinic wall-clock time to an instant.
 * - nonexistent time (spring-forward gap): error
 * - ambiguous time (fall-back overlap): `earlier` (first occurrence, default) or `later`
 */
export const localToInstant = (
  date: LocalDate,
  time: LocalTime,
  tz: string,
  disambiguation: Disambiguation = 'earlier',
): Result<Date, 'NONEXISTENT_LOCAL_TIME'> => {
  const [y, mo, d] = parseDate(date);
  const [h, mi] = parseTime(time);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const offsets = new Set([
    offsetMinutesAt(new Date(wall - DAY_MS), tz),
    offsetMinutesAt(new Date(wall + DAY_MS), tz),
  ]);
  const valid: number[] = [];
  for (const o of offsets) {
    const candidate = wall - o * MS_MIN;
    if (offsetMinutesAt(new Date(candidate), tz) === o) valid.push(candidate);
  }
  if (valid.length === 0) return err('NONEXISTENT_LOCAL_TIME');
  valid.sort((a, b) => a - b);
  const pick = disambiguation === 'earlier' ? valid[0] : valid[valid.length - 1];
  return ok(new Date(pick ?? 0));
};

export const addMinutes = (instant: Date, minutes: number): Date =>
  new Date(instant.getTime() + minutes * MS_MIN);

export const minutesOfTime = (time: LocalTime): number => {
  const [h, m] = parseTime(time);
  return h * 60 + m;
};

export const timeOfMinutes = (minutes: number): LocalTime =>
  `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/**
 * Reminder instants for an appointment.
 * 24h reminder = the same clinic wall-clock time on the previous calendar day (never shifts
 * by an hour across DST). If that wall time does not exist, fall back to start − 24h.
 * 2h reminder = absolute start − 2h.
 */
export const reminderInstants = (startsAt: Date, tz: string): { h24: Date; h2: Date } => {
  const local = instantToLocal(startsAt, tz);
  const prev = localToInstant(addDays(local.date, -1), local.time, tz, 'earlier');
  return {
    h24: prev.ok ? prev.value : addMinutes(startsAt, -24 * 60),
    h2: addMinutes(startsAt, -120),
  };
};
