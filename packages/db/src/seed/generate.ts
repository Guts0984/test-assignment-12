import {
  CLINIC_DEFS,
  addDays,
  localDateOf,
  localToInstant,
  minutesOfTime,
  isoWeekday,
  type Currency,
} from '@clinic/shared';
import { createRng, type Rng } from './prng.js';
import {
  FIRST_PL,
  FIRST_UK,
  LAST_PL,
  LAST_UK,
  SERVICES,
  SPECIALTIES,
  pricePln,
} from './data.js';
import type { CellValue } from './copy.js';

export type SeedOptions = {
  rng: number;
  doctors: number;
  patients: number;
  appointments: number;
  pastDays: number;
  futureDays: number;
  now: Date;
  passwordHash: string;
};

type Row = CellValue[];

export type SeedData = {
  clinics: Row[];
  rooms: Row[];
  services: Row[];
  clinicServices: Row[];
  doctors: Row[];
  doctorServices: Row[];
  users: Row[];
  patients: Row[];
  templates: Row[];
  exceptions: Row[];
  appointments: Row[];
  events: Row[];
  waitlistEntries: Row[];
  waitlistOffers: Row[];
  penalties: Row[];
  stats: { active: number; cancelled: number; futureActive: number; blockedPatients: number };
};

const MIN = 60_000;
const PREP = 5;

type Clinic = { id: string; code: string; tz: string; currency: Currency; roomId: string };
type Service = { id: string; durationMin: number; uzi: boolean; weight: number; specialty: string };
type Shift = { start: string; end: string; bs: string | null; be: string | null };
type Template = { weekday: number; clinicIdx: number; shift: Shift };
type Doctor = {
  id: string;
  idx: number;
  specialty: string;
  services: Service[];
  templates: Template[];
  userId: string;
};
type Exception = {
  kind: 'vacation' | 'sick' | 'day_off' | 'extra_day' | 'custom_hours';
  clinicIdx: number | null;
  shift: Shift | null;
};
type Appt = {
  id: string;
  patientIdx: number;
  doctor: Doctor;
  clinic: Clinic;
  service: Service;
  startMs: number;
  endMs: number;
  localDate: string;
  status: 'booked' | 'checked_in' | 'completed' | 'no_show' | 'cancelled';
  kind: 'regular' | 'waitlist_offer';
  createdMs: number;
  bookedMs: number | null;
  cancelledMs: number | null;
  late: boolean;
  priceMinor: number;
  rescheduledFromMs: number | null;
};

const SHIFTS: readonly Shift[] = [
  { start: '08:00', end: '19:00', bs: '13:00', be: '14:00' },
  { start: '09:00', end: '20:00', bs: '14:00', be: '15:00' },
  { start: '08:00', end: '18:00', bs: '12:00', be: '12:30' },
  { start: '10:00', end: '20:00', bs: '14:00', be: '14:30' },
];
const SATURDAY: Shift = { start: '09:00', end: '15:00', bs: null, be: null };

export const generateSeed = (o: SeedOptions): SeedData => {
  const rng = createRng(o.rng);
  const nowMs = o.now.getTime();

  // ---- clinics, rooms, services ----
  const clinics: Clinic[] = CLINIC_DEFS.map((c) => ({
    id: rng.uuid(),
    code: c.code,
    tz: c.timeZone,
    currency: c.currency,
    roomId: rng.uuid(),
  }));
  const services: Service[] = SERVICES.map((s) => ({
    id: rng.uuid(),
    durationMin: s.durationMin,
    uzi: s.needsUltrasound,
    weight: s.weight,
    specialty: s.specialty,
  }));
  const clinicRows: Row[] = CLINIC_DEFS.map((c, i) => {
    const cl = clinics[i] as Clinic;
    return [cl.id, c.code, c.city, c.timeZone, c.currency];
  });
  const roomRows: Row[] = clinics.map((c) => [c.roomId, c.id, 'ultrasound', `UZI ${c.code}`]);
  const serviceRows: Row[] = SERVICES.map((s, i) => [
    (services[i] as Service).id, s.code, s.specialty, s.nameUk, s.nameEn, s.namePl, s.durationMin, s.needsUltrasound,
  ]);
  const priceOf = (clinic: Clinic, i: number): number => {
    const uah = (SERVICES[i] as (typeof SERVICES)[number]).priceUah;
    if (clinic.currency === 'PLN') return pricePln(uah);
    return Math.round(uah * (clinic.code === 'lviv' ? 0.95 : 1)) * 100;
  };
  const priceMap = new Map<string, number>();
  const clinicServiceRows: Row[] = [];
  for (const c of clinics)
    services.forEach((s, i) => {
      const p = priceOf(c, i);
      priceMap.set(`${c.id}|${s.id}`, p);
      clinicServiceRows.push([c.id, s.id, p]);
    });

  // ---- doctors, templates ----
  const clinicWeights: readonly (readonly [number, number])[] = [[0, 45], [1, 25], [2, 30]];
  const doctors: Doctor[] = [];
  const doctorRows: Row[] = [];
  const doctorServiceRows: Row[] = [];
  const templateRows: Row[] = [];
  const userRows: Row[] = [];
  const dualCount = Math.max(1, Math.round(o.doctors * 0.15));
  const nameFor = (clinicIdx: number): string => {
    if (clinicIdx === 2) return `${rng.pick(FIRST_PL)} ${rng.pick(LAST_PL)}`;
    return `${rng.pick(FIRST_UK)} ${rng.pick(LAST_UK)}`;
  };
  for (let i = 0; i < o.doctors; i++) {
    const specialty = SPECIALTIES[i % SPECIALTIES.length] as string;
    const primary = rng.weighted(clinicWeights);
    const dual = i < dualCount;
    const secondary = dual ? (primary + 1 + rng.int(0, 1)) % 3 : primary;
    const weekdays = [1, 2, 3, 4, 5];
    if (rng.chance(0.6)) weekdays.push(6);
    if (rng.chance(0.2)) weekdays.splice(rng.int(0, weekdays.length - 1), 1);
    const shift = rng.pick(SHIFTS);
    const templates: Template[] = weekdays.map((wd, k) => ({
      weekday: wd,
      clinicIdx: dual && k % 2 === 1 ? secondary : primary,
      shift: wd === 6 ? SATURDAY : shift,
    }));
    const own = services.filter((s) => s.specialty === specialty);
    const doc: Doctor = { id: rng.uuid(), idx: i, specialty, services: own, templates, userId: rng.uuid() };
    doctors.push(doc);
    doctorRows.push([doc.id, nameFor(primary), specialty]);
    for (const s of own) doctorServiceRows.push([doc.id, s.id]);
    for (const t of templates)
      templateRows.push([
        rng.uuid(), doc.id, (clinics[t.clinicIdx] as Clinic).id, t.weekday,
        t.shift.start, t.shift.end, t.shift.bs, t.shift.be,
      ]);
  }

  // ---- exceptions ----
  const today = localDateOf(o.now, 'Europe/Kyiv');
  const first = addDays(today, -o.pastDays);
  const totalDays = o.pastDays + o.futureDays + 1;
  const dates: string[] = Array.from({ length: totalDays }, (_, k) => addDays(first, k));
  const exByDoctor = new Map<number, Map<number, Exception>>();
  const exceptionRows: Row[] = [];
  for (const doc of doctors) {
    const m = new Map<number, Exception>();
    exByDoctor.set(doc.idx, m);
    const put = (k: number, e: Exception): void => {
      if (k < 0 || k >= totalDays || m.has(k)) return;
      m.set(k, e);
      const clinic = e.clinicIdx === null ? null : (clinics[e.clinicIdx] as Clinic).id;
      exceptionRows.push([
        rng.uuid(), doc.id, dates[k] as string, e.kind, clinic,
        e.shift?.start ?? null, e.shift?.end ?? null, e.shift?.bs ?? null, e.shift?.be ?? null,
      ]);
    };
    const primaryIdx = (doc.templates[0] as Template).clinicIdx;
    for (let v = rng.int(1, 2); v > 0; v--) {
      const len = rng.int(5, 14);
      const at = rng.int(0, totalDays - 1);
      for (let d = 0; d < len; d++) put(at + d, { kind: 'vacation', clinicIdx: null, shift: null });
    }
    for (let s = rng.int(2, 3); s > 0; s--) put(rng.int(0, totalDays - 1), { kind: 'sick', clinicIdx: null, shift: null });
    for (let s = 2; s > 0; s--) put(rng.int(0, totalDays - 1), { kind: 'day_off', clinicIdx: null, shift: null });
    for (let s = 2; s > 0; s--) {
      const k = rng.int(0, totalDays - 1);
      const wd = isoWeekday(dates[k] as string);
      if (!doc.templates.some((t) => t.weekday === wd))
        put(k, { kind: 'extra_day', clinicIdx: primaryIdx, shift: SATURDAY });
    }
    for (let s = rng.int(1, 2); s > 0; s--) {
      const k = rng.int(0, totalDays - 1);
      const wd = isoWeekday(dates[k] as string);
      const t = doc.templates.find((x) => x.weekday === wd);
      if (t) put(k, { kind: 'custom_hours', clinicIdx: t.clinicIdx, shift: { start: '10:00', end: '16:00', bs: null, be: null } });
    }
  }

  // ---- patients (+ users) ----
  const patientRows: Row[] = [];
  const patientUser: (string | null)[] = [];
  const patientHome: number[] = [];
  const registrarUser: string[] = [];
  userRows.push([rng.uuid(), 'manager@demo.local', o.passwordHash, 'manager', null, null]);
  clinics.forEach((c) => {
    const id = rng.uuid();
    registrarUser.push(id);
    userRows.push([id, `registrar.${c.code}@demo.local`, o.passwordHash, 'registrar', c.id, null]);
  });
  for (const doc of doctors)
    userRows.push([doc.userId, `doctor${String(doc.idx + 1).padStart(2, '0')}@demo.local`, o.passwordHash, 'doctor', null, doc.id]);
  const withUser = Math.floor(o.patients * 0.9);
  const patientIds: string[] = [];
  for (let i = 0; i < o.patients; i++) {
    const home = i < o.patients * 0.45 ? 0 : i < o.patients * 0.7 ? 1 : 2;
    patientHome.push(home);
    const pid = rng.uuid();
    patientIds.push(pid);
    let userId: string | null = null;
    const email = `patient${String(i + 1).padStart(5, '0')}@demo.local`;
    if (i < withUser) {
      userId = rng.uuid();
      userRows.push([userId, email, o.passwordHash, 'patient', null, null]);
    }
    patientUser.push(userId);
    const phone = home === 2 ? `+48${String(500_000_000 + i).padStart(9, '0')}` : `+380${String(500_000_000 + i).padStart(9, '0')}`;
    patientRows.push([pid, userId, nameFor(home), phone, userId ? email : null, home === 2 ? 'pl' : rng.chance(0.15) ? 'en' : 'uk', null, new Date(nowMs - rng.int(1, 700) * 86_400_000)]);
  }
  const homeRanges = [
    [0, Math.floor(o.patients * 0.45)],
    [Math.floor(o.patients * 0.45), Math.floor(o.patients * 0.7)],
    [Math.floor(o.patients * 0.7), o.patients],
  ] as const;

  // ---- appointments ----
  const patientBusy = new Map<number, number[]>(); // flat [start,end,...]
  const patientDoctorDay = new Set<string>();
  const patientFuture = new Map<number, number>();
  const uziBusy = new Map<string, number[]>();
  const active: Appt[] = [];
  const workDays: { doc: Doctor; clinic: Clinic; k: number; startMs: number; intervals: [number, number][] }[] = [];

  const pickPatient = (clinicIdx: number, startMs: number, endMs: number, doc: Doctor, date: string): number => {
    for (let tries = 0; tries < 12; tries++) {
      const [lo, hi] = rng.chance(0.92) ? homeRanges[clinicIdx] as readonly [number, number] : [0, o.patients] as const;
      const p = rng.int(lo, Math.max(lo, hi - 1));
      if (patientDoctorDay.has(`${p}|${doc.idx}|${date}`)) continue;
      const busy = patientBusy.get(p);
      if (busy) {
        let clash = false;
        for (let j = 0; j < busy.length; j += 2) if ((busy[j] as number) < endMs && startMs < (busy[j + 1] as number)) { clash = true; break; }
        if (clash) continue;
      }
      if (startMs > nowMs && (patientFuture.get(p) ?? 0) >= 3) continue;
      return p;
    }
    return -1;
  };

  const FILL = 0.88;
  const FILL_FUTURE = 0.45; // upcoming days keep real free time, so the demo grid is not empty
  for (const doc of doctors) {
    const exm = exByDoctor.get(doc.idx) as Map<number, Exception>;
    for (let k = 0; k < totalDays; k++) {
      const date = dates[k] as string;
      const wd = isoWeekday(date);
      const ex = exm.get(k);
      let clinicIdx: number;
      let shift: Shift;
      if (ex) {
        if (ex.kind === 'extra_day' || ex.kind === 'custom_hours') {
          clinicIdx = ex.clinicIdx as number;
          shift = ex.shift as Shift;
        } else continue;
      } else {
        const t = doc.templates.find((x) => x.weekday === wd);
        if (!t) continue;
        clinicIdx = t.clinicIdx;
        shift = t.shift;
      }
      const clinic = clinics[clinicIdx] as Clinic;
      const start0 = localToInstant(date, shift.start, clinic.tz);
      if (!start0.ok) continue;
      const startMs0 = start0.value.getTime();
      const s0 = minutesOfTime(shift.start);
      const intervals: [number, number][] = shift.bs && shift.be
        ? [[s0, minutesOfTime(shift.bs)], [minutesOfTime(shift.be), minutesOfTime(shift.end)]]
        : [[s0, minutesOfTime(shift.end)]];
      const abs = (m: number): number => startMs0 + (m - s0) * MIN;
      workDays.push({ doc, clinic, k, startMs: startMs0, intervals: intervals.map(([a, b]) => [abs(a), abs(b)]) });
      for (const [from, to] of intervals) {
        let cur = from;
        while (cur + 15 <= to) {
          if (!rng.chance(k > o.pastDays ? FILL_FUTURE : FILL)) { cur += 15; continue; }
          const fits = doc.services.filter((s) => cur + s.durationMin <= to);
          if (fits.length === 0) break;
          const svc = rng.weighted(fits.map((s) => [s, s.weight] as const));
          const startMs = abs(cur);
          const endMs = startMs + svc.durationMin * MIN;
          const occEnd = endMs + PREP * MIN;
          if (svc.uzi) {
            const key = `${clinic.id}|${date}`;
            const list = uziBusy.get(key) ?? [];
            let clash = false;
            for (let j = 0; j < list.length; j += 2) if ((list[j] as number) < occEnd && startMs < (list[j + 1] as number)) { clash = true; break; }
            if (clash) { cur += 15; continue; }
            list.push(startMs, occEnd);
            uziBusy.set(key, list);
          }
          const p = pickPatient(clinicIdx, startMs, endMs, doc, date);
          if (p < 0) { cur += 15; continue; }
          const b = patientBusy.get(p) ?? [];
          b.push(startMs, endMs);
          patientBusy.set(p, b);
          patientDoctorDay.add(`${p}|${doc.idx}|${date}`);
          if (startMs > nowMs) patientFuture.set(p, (patientFuture.get(p) ?? 0) + 1);
          active.push(buildActive(rng, nowMs, p, doc, clinic, svc, startMs, endMs, date, priceMap));
          cur += Math.ceil((svc.durationMin + PREP) / 15) * 15;
        }
      }
    }
  }

  // thin out if we generated more than requested
  while (active.length > o.appointments) {
    const i = rng.int(0, active.length - 1);
    active[i] = active[active.length - 1] as Appt;
    active.pop();
  }

  // ---- cancelled top-up (cancelled rows are free of overlap rules) ----
  const cancelled: Appt[] = [];
  const need = o.appointments - active.length;
  if (need > 0 && workDays.length > 0) {
    for (let n = 0; n < need; n++) {
      const wdDay = rng.pick(workDays);
      const [from, to] = rng.pick(wdDay.intervals);
      const svc = rng.pick(wdDay.doc.services);
      const slots = Math.floor((to - from - svc.durationMin * MIN) / (15 * MIN));
      if (slots < 0) { n--; continue; }
      const startMs = from + rng.int(0, slots) * 15 * MIN;
      const clinicIdx = clinics.indexOf(wdDay.clinic);
      const [plo, phi] = homeRanges[clinicIdx] as readonly [number, number];
      const p = rng.int(plo, Math.max(plo, phi - 1));
      const date = dates[wdDay.k] as string;
      cancelled.push(buildCancelled(rng, nowMs, p, wdDay.doc, wdDay.clinic, svc, startMs, startMs + svc.durationMin * MIN, date, priceMap));
    }
  }

  // ---- waitlist offers marked on a few appointments ----
  const all: Appt[] = [...active, ...cancelled];
  const waitlistEntries: Row[] = [];
  const waitlistOffers: Row[] = [];
  for (const a of all) {
    if (a.bookedMs === null || !rng.chance(0.004)) continue;
    a.kind = 'waitlist_offer';
    const accepted = a.status !== 'cancelled';
    const entryId = rng.uuid();
    const created = a.bookedMs - 15 * MIN;
    waitlistEntries.push([
      entryId, patientIds[a.patientIdx] as string, a.doctor.id, a.service.id,
      a.localDate, addDays(a.localDate, rng.int(3, 14)), rng.chance(0.2) ? 1 : 0,
      accepted ? 'fulfilled' : 'active', new Date(created - rng.int(1, 5) * 86_400_000),
    ]);
    waitlistOffers.push([
      entryId, a.id, new Date(created + 15 * MIN),
      accepted ? 'accepted' : rng.pick(['declined', 'expired']),
      new Date(created), new Date(created + rng.int(1, 14) * MIN),
    ]);
  }
  const futureStart = addDays(today, 1);
  for (let i = 0; i < Math.min(250, Math.floor(o.patients / 10)); i++) {
    const doc = rng.pick(doctors);
    const p = rng.int(0, Math.max(0, withUser - 1));
    waitlistEntries.push([
      rng.uuid(), patientIds[p] as string, doc.id, rng.pick(doc.services).id,
      addDays(futureStart, rng.int(0, 5)), addDays(futureStart, rng.int(10, 30)), rng.chance(0.1) ? 1 : 0,
      'active', new Date(nowMs - rng.int(1, 20 * 24 * 60) * MIN),
    ]);
  }

  // ---- appointment rows, events, penalties ----
  const appointmentRows: Row[] = [];
  const events: Row[] = [];
  const penalties: Row[] = [];
  const penaltyTimes = new Map<number, number[]>();
  const addPenalty = (a: Appt, kind: 'no_show' | 'late_cancel', atMs: number): void => {
    penalties.push([patientIds[a.patientIdx] as string, kind, a.id, new Date(atMs)]);
    const l = penaltyTimes.get(a.patientIdx) ?? [];
    l.push(atMs);
    penaltyTimes.set(a.patientIdx, l);
  };
  const ev = (a: Appt, atMs: number, userId: string | null, role: string, type: string, from: string | null, to: string, extra?: { old?: number; late?: boolean; reason?: string }): void => {
    events.push([
      a.id, new Date(atMs), userId, role, type, from, to,
      extra?.old === undefined ? null : new Date(extra.old),
      new Date(a.startMs), extra?.late ?? false, extra?.reason ?? null,
    ]);
  };
  for (const a of all) {
    const clinicIdx = clinics.indexOf(a.clinic);
    const online = patientUser[a.patientIdx] !== null && rng.chance(0.8);
    const creator = online ? { id: patientUser[a.patientIdx] as string, role: 'patient' } : { id: registrarUser[clinicIdx] as string, role: 'registrar' };
    const priceOfRow = a.priceMinor;
    const status = a.status;
    const version = a.rescheduledFromMs !== null ? 2 : 1;
    appointmentRows.push([
      a.id, patientIds[a.patientIdx] as string, a.doctor.id, a.clinic.id, a.service.id,
      a.service.uzi ? a.clinic.roomId : null,
      new Date(a.startMs), new Date(a.endMs), PREP,
      new Date(a.endMs + PREP * MIN), a.localDate, status, a.kind, null,
      priceOfRow, a.clinic.currency, version,
      a.bookedMs === null ? null : new Date(a.bookedMs),
      a.cancelledMs === null ? null : new Date(a.cancelledMs),
      a.late, new Date(a.createdMs), new Date(a.cancelledMs ?? a.bookedMs ?? a.createdMs),
    ]);
    ev(a, a.createdMs, creator.id, creator.role, 'held', null, 'held');
    if (a.bookedMs !== null) ev(a, a.bookedMs, creator.id, creator.role, 'confirmed', 'held', 'booked');
    if (a.rescheduledFromMs !== null && a.bookedMs !== null)
      ev(a, a.bookedMs + 5 * MIN, creator.id, creator.role, 'rescheduled', 'booked', 'booked', { old: a.rescheduledFromMs });
    const reg = registrarUser[clinicIdx] as string;
    if (status === 'cancelled') {
      if (a.bookedMs === null) ev(a, a.cancelledMs as number, null, 'system', 'cancelled', 'held', 'cancelled', { reason: 'hold_expired' });
      else {
        const byPatient = patientUser[a.patientIdx] !== null && rng.chance(0.65);
        ev(a, a.cancelledMs as number, byPatient ? (patientUser[a.patientIdx] as string) : reg, byPatient ? 'patient' : 'registrar', 'cancelled', 'booked', 'cancelled', { late: a.late });
        if (a.late && (a.cancelledMs as number) <= nowMs) addPenalty(a, 'late_cancel', a.cancelledMs as number);
      }
    } else if (status === 'checked_in') {
      ev(a, a.startMs - 10 * MIN, reg, 'registrar', 'checked_in', 'booked', 'checked_in');
    } else if (status === 'completed') {
      ev(a, a.startMs - 10 * MIN, reg, 'registrar', 'checked_in', 'booked', 'checked_in');
      ev(a, a.endMs, a.doctor.userId, 'doctor', 'completed', 'checked_in', 'completed');
    } else if (status === 'no_show') {
      ev(a, a.startMs + 15 * MIN, reg, 'registrar', 'no_show', 'booked', 'no_show');
      addPenalty(a, 'no_show', a.startMs + 15 * MIN);
    }
  }

  // online block: second penalty inside 90 days → 30 days closed
  let blocked = 0;
  for (const [p, times] of penaltyTimes) {
    times.sort((x, y) => x - y);
    let until = 0;
    for (let i = 1; i < times.length; i++) {
      const t = times[i] as number;
      if (t - (times[i - 1] as number) <= 90 * 86_400_000 || times.slice(0, i).filter((x) => t - x <= 90 * 86_400_000).length >= 1)
        until = Math.max(until, t + 30 * 86_400_000);
    }
    if (until > nowMs) {
      (patientRows[p] as Row)[6] = new Date(until);
      blocked++;
    }
  }

  return {
    clinics: clinicRows, rooms: roomRows, services: serviceRows, clinicServices: clinicServiceRows,
    doctors: doctorRows, doctorServices: doctorServiceRows, users: userRows, patients: patientRows,
    templates: templateRows, exceptions: exceptionRows, appointments: appointmentRows, events,
    waitlistEntries, waitlistOffers, penalties,
    stats: {
      active: active.length,
      cancelled: cancelled.length,
      futureActive: active.filter((a) => a.startMs > nowMs).length,
      blockedPatients: blocked,
    },
  };
};

const buildActive = (
  rng: Rng, nowMs: number, patientIdx: number, doctor: Doctor, clinic: Clinic, service: Service,
  startMs: number, endMs: number, localDate: string, priceMap: Map<string, number>,
): Appt => {
  const status: Appt['status'] =
    startMs > nowMs ? 'booked'
    : startMs > nowMs - 45 * MIN ? (rng.chance(0.5) ? 'checked_in' : 'completed')
    : rng.chance(0.07) ? 'no_show' : 'completed';
  const lead = rng.int(3 * 60, 40 * 24 * 60) * MIN;
  const createdMs = Math.min(startMs - lead, nowMs - rng.int(1, 30 * 24 * 60) * MIN);
  return {
    id: rng.uuid(), patientIdx, doctor, clinic, service, startMs, endMs, localDate, status,
    kind: 'regular', createdMs, bookedMs: createdMs + rng.int(1, 9) * MIN, cancelledMs: null, late: false,
    priceMinor: priceMap.get(`${clinic.id}|${service.id}`) as number,
    rescheduledFromMs: rng.chance(0.03) ? startMs - rng.int(1, 20) * 24 * 3600_000 : null,
  };
};

const buildCancelled = (
  rng: Rng, nowMs: number, patientIdx: number, doctor: Doctor, clinic: Clinic, service: Service,
  startMs: number, endMs: number, localDate: string, priceMap: Map<string, number>,
): Appt => {
  const lead = rng.int(3 * 60, 40 * 24 * 60) * MIN;
  const createdMs = Math.min(startMs - lead, nowMs - rng.int(2, 30 * 24 * 60) * MIN);
  const abandoned = rng.chance(0.06);
  let bookedMs: number | null = null;
  let cancelledMs: number;
  let late = false;
  if (abandoned) {
    cancelledMs = createdMs + 10 * MIN;
  } else {
    bookedMs = createdMs + rng.int(1, 9) * MIN;
    const wantLate = rng.chance(0.08);
    const wanted = wantLate ? startMs - rng.int(60, 23 * 60) * MIN : startMs - rng.int(25 * 60, 14 * 24 * 60) * MIN;
    cancelledMs = Math.max(bookedMs + MIN, Math.min(wanted, nowMs - MIN));
    late = startMs - cancelledMs < 24 * 3600_000;
  }
  return {
    id: rng.uuid(), patientIdx, doctor, clinic, service, startMs, endMs, localDate, status: 'cancelled',
    kind: 'regular', createdMs, bookedMs, cancelledMs, late,
    priceMinor: priceMap.get(`${clinic.id}|${service.id}`) as number,
    rescheduledFromMs: null,
  };
};

export const rowsOfAppointmentColumns = [
  'id', 'patient_id', 'doctor_id', 'clinic_id', 'service_id', 'room_id', 'starts_at', 'ends_at',
  'prep_minutes', 'occupied_until', 'local_date', 'status', 'kind', 'hold_expires_at', 'price_minor',
  'currency', 'version', 'booked_at', 'cancelled_at', 'cancelled_late', 'created_at', 'updated_at',
] as const;
