import { loadAvailabilityInputs, type Db } from '@clinic/db';
import { AVAILABILITY_DAYS, addDays, localDateOf, localToInstant, ok, type AppError, type Result } from '@clinic/shared';
import { fail, type Ctx } from './context.js';
import { computeSlots, type Slot } from './grid.js';

export type AvailabilityResult = {
  timeZone: string;
  currency: 'UAH' | 'PLN';
  durationMin: number;
  priceMinor: number;
  doctors: { id: string; fullName: string; specialty: string }[];
  slots: Slot[];
};

/** Free times for a service in one clinic (city) for the next 14 clinic-local days. */
export const getAvailability = async (
  ctx: Ctx,
  q: { clinicId: string; serviceId: string; doctorId?: string | undefined; fromDate?: string | undefined; days?: number | undefined },
  db: Db = ctx.db,
): Promise<Result<AvailabilityResult, AppError>> => {
  const now = ctx.now();
  const clinicRow = await loadAvailabilityInputs(db, {
    clinicId: q.clinicId,
    serviceId: q.serviceId,
    doctorId: q.doctorId,
    windowStart: now,
    windowEnd: now,
    fromDate: '2000-01-01',
    toDate: '2000-01-01',
    now,
  });
  if (!clinicRow.clinic) return fail('NOT_FOUND', 'Clinic not found');
  const tz = clinicRow.clinic.timeZone;
  const today = localDateOf(now, tz);
  const days = Math.min(q.days ?? AVAILABILITY_DAYS, AVAILABILITY_DAYS);
  const fromDate = q.fromDate && q.fromDate > today ? q.fromDate : today;
  const toDate = addDays(fromDate, days - 1);
  const start = localToInstant(fromDate, '00:00', tz, 'later');
  const end = localToInstant(addDays(toDate, 1), '00:00', tz, 'later');
  const inputs = await loadAvailabilityInputs(db, {
    clinicId: q.clinicId,
    serviceId: q.serviceId,
    doctorId: q.doctorId,
    windowStart: start.ok ? start.value : now,
    windowEnd: end.ok ? end.value : new Date(now.getTime() + (days + 1) * 86_400_000),
    fromDate,
    toDate,
    now,
  });
  if (!inputs.clinic || !inputs.service) return fail('NOT_FOUND', 'The clinic does not offer this service');
  const slots = computeSlots({
    timeZone: inputs.clinic.timeZone,
    clinicId: q.clinicId,
    durationMin: inputs.service.durationMin,
    needsUltrasound: inputs.service.needsUltrasound,
    prepMinutes: ctx.rules.prepMinutes,
    fromDate,
    days,
    now,
    minLeadMinutes: ctx.rules.minLeadMinutes,
    maxAdvanceDays: ctx.rules.maxAdvanceDays,
    doctorIds: inputs.doctors.map((d) => d.id),
    templates: inputs.templates,
    exceptions: inputs.exceptions,
    doctorBusy: inputs.doctorBusy,
    roomBusy: inputs.roomBusy,
  });
  return ok({
    timeZone: inputs.clinic.timeZone,
    currency: inputs.clinic.currency,
    durationMin: inputs.service.durationMin,
    priceMinor: inputs.service.priceMinor,
    doctors: inputs.doctors,
    slots,
  });
};
