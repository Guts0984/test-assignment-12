import {
  SLOT_STEP_MINUTES,
  addDays,
  addMinutes,
  isoWeekday,
  localToInstant,
  minutesOfTime,
  offsetMinutesAt,
  timeOfMinutes,
} from '@clinic/shared';

/** Everything the grid needs. Shape-compatible with `AvailabilityInputs` from @clinic/db. */
export type GridInput = {
  timeZone: string;
  clinicId: string;
  durationMin: number;
  needsUltrasound: boolean;
  prepMinutes: number;
  /** First clinic-local date and how many dates to cover. */
  fromDate: string;
  days: number;
  now: Date;
  minLeadMinutes: number;
  maxAdvanceDays: number;
  doctorIds: readonly string[];
  templates: readonly {
    doctorId: string;
    weekday: number;
    startLocal: string;
    endLocal: string;
    breakStartLocal: string | null;
    breakEndLocal: string | null;
  }[];
  exceptions: readonly {
    doctorId: string;
    localDate: string;
    kind: string;
    clinicId: string | null;
    startLocal: string | null;
    endLocal: string | null;
    breakStartLocal: string | null;
    breakEndLocal: string | null;
  }[];
  doctorBusy: readonly { doctorId: string; startsAt: Date; occupiedUntil: Date }[];
  roomBusy: readonly { startsAt: Date; occupiedUntil: Date }[];
};

export type Slot = {
  doctorId: string;
  startsAt: Date;
  endsAt: Date;
  localDate: string;
  localTime: string;
};

/** Working time inside one local day, in minutes from local midnight. */
export type Interval = { readonly start: number; readonly end: number };

const NO_WORK: Interval[] = [];

/**
 * Working intervals of a doctor in this clinic on a date.
 * - vacation / sick / day_off: none
 * - extra_day / custom_hours: the exception's own hours, only if it is for this clinic
 * - otherwise the weekly template of this clinic, minus the break
 */
export const workingIntervals = (
  input: Pick<GridInput, 'templates' | 'exceptions' | 'clinicId'>,
  doctorId: string,
  date: string,
): Interval[] => {
  const ex = input.exceptions.find((e) => e.doctorId === doctorId && e.localDate === date);
  let hours: { start: string; end: string; bs: string | null; be: string | null };
  if (ex) {
    if (ex.kind !== 'extra_day' && ex.kind !== 'custom_hours') return NO_WORK;
    if (ex.clinicId !== input.clinicId || !ex.startLocal || !ex.endLocal) return NO_WORK;
    hours = { start: ex.startLocal, end: ex.endLocal, bs: ex.breakStartLocal, be: ex.breakEndLocal };
  } else {
    const wd = isoWeekday(date);
    const t = input.templates.find((x) => x.doctorId === doctorId && x.weekday === wd);
    if (!t) return NO_WORK;
    hours = { start: t.startLocal, end: t.endLocal, bs: t.breakStartLocal, be: t.breakEndLocal };
  }
  const s = minutesOfTime(hours.start);
  const e = minutesOfTime(hours.end);
  if (hours.bs && hours.be) {
    const bs = minutesOfTime(hours.bs);
    const be = minutesOfTime(hours.be);
    const out: Interval[] = [];
    if (bs > s) out.push({ start: s, end: Math.min(bs, e) });
    if (be < e) out.push({ start: Math.max(be, s), end: e });
    return out;
  }
  return [{ start: s, end: e }];
};

type Busy = { s: number; e: number };
const toBusy = (list: readonly { startsAt: Date; occupiedUntil: Date }[]): Busy[] =>
  list.map((b) => ({ s: b.startsAt.getTime(), e: b.occupiedUntil.getTime() })).sort((a, b) => a.s - b.s);

const overlaps = (busy: Busy[], s: number, e: number): boolean => {
  // busy is sorted by start; a linear pass over the few intervals near the day is enough
  for (const b of busy) {
    if (b.s >= e) return false;
    if (b.e > s) return true;
  }
  return false;
};

/**
 * The free-time grid.
 *
 * A start is offered when ALL hold:
 *  1. it is on the 15-minute wall-clock grid of the clinic (:00 :15 :30 :45);
 *  2. [start, start + duration) lies inside one working interval (so never across the break
 *     or past the end of the day);
 *  3. [start, start + duration + prep) overlaps no busy interval of the doctor, and, for
 *     ultrasound services, none of the clinic room. Busy intervals already include the preparation
 *     time of the visit they belong to;
 *  4. start >= now + minLead and start <= now + maxAdvance;
 *  5. the wall-clock time exists (a start inside the spring-forward gap is skipped; inside the
 *     fall-back overlap the first occurrence is used).
 * The preparation time may extend past the end of the day or into the break.
 */
export const computeSlots = (input: GridInput): Slot[] => {
  const tz = input.timeZone;
  const earliest = input.now.getTime() + input.minLeadMinutes * 60_000;
  const latest = input.now.getTime() + input.maxAdvanceDays * 86_400_000;
  const blockMs = (input.durationMin + input.prepMinutes) * 60_000;
  const durMs = input.durationMin * 60_000;
  const roomBusy = input.needsUltrasound ? toBusy(input.roomBusy) : [];
  const busyByDoctor = new Map<string, Busy[]>();
  for (const id of input.doctorIds) busyByDoctor.set(id, []);
  for (const b of input.doctorBusy) busyByDoctor.get(b.doctorId)?.push({ s: b.startsAt.getTime(), e: b.occupiedUntil.getTime() });
  for (const list of busyByDoctor.values()) list.sort((a, b) => a.s - b.s);

  const out: Slot[] = [];
  for (let d = 0; d < input.days; d++) {
    const date = addDays(input.fromDate, d);
    for (const doctorId of input.doctorIds) {
      const intervals = workingIntervals(input, doctorId, date);
      if (intervals.length === 0) continue;
      const busy = busyByDoctor.get(doctorId) ?? [];
      for (const iv of intervals) {
        const first = Math.ceil(iv.start / SLOT_STEP_MINUTES) * SLOT_STEP_MINUTES;
        // one conversion per interval; valid while the UTC offset does not change inside it
        const base = localToInstant(date, timeOfMinutes(first), tz, 'earlier');
        const baseOk = base.ok;
        const baseMs = baseOk ? base.value.getTime() : 0;
        const lastEndOffset = baseOk
          ? offsetMinutesAt(new Date(baseMs + (iv.end - first) * 60_000), tz)
          : 0;
        const stable = baseOk && offsetMinutesAt(base.value, tz) === lastEndOffset;
        for (let m = first; m + input.durationMin <= iv.end; m += SLOT_STEP_MINUTES) {
          let sMs: number;
          if (stable) sMs = baseMs + (m - first) * 60_000;
          else {
            const r = localToInstant(date, timeOfMinutes(m), tz, 'earlier');
            if (!r.ok) continue;
            sMs = r.value.getTime();
          }
          if (sMs < earliest || sMs > latest) continue;
          if (overlaps(busy, sMs, sMs + blockMs)) continue;
          if (input.needsUltrasound && overlaps(roomBusy, sMs, sMs + blockMs)) continue;
          out.push({
            doctorId,
            startsAt: new Date(sMs),
            endsAt: new Date(sMs + durMs),
            localDate: date,
            localTime: timeOfMinutes(m),
          });
        }
      }
    }
  }
  return out;
};

/** Is `startsAt` a start the schedule allows for this service, ignoring who else is booked? */
export const isWorkingStart = (
  input: Omit<GridInput, 'doctorBusy' | 'roomBusy' | 'days' | 'fromDate' | 'now' | 'minLeadMinutes' | 'maxAdvanceDays'>,
  doctorId: string,
  startsAt: Date,
  localDate: string,
): boolean => {
  const slots = computeSlots({
    ...input,
    doctorIds: [doctorId],
    fromDate: localDate,
    days: 1,
    now: addMinutes(startsAt, -60 * 24 * 365),
    minLeadMinutes: 0,
    maxAdvanceDays: 366 * 2,
    doctorBusy: [],
    roomBusy: [],
  });
  return slots.some((s) => s.startsAt.getTime() === startsAt.getTime());
};
