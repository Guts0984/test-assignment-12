import { z } from 'zod';
import {
  LOCALES,
  MAX_SERVICE_MINUTES,
  MAX_WAITLIST_RANGE_DAYS,
  MIN_SERVICE_MINUTES,
  SLOT_STEP_MINUTES,
} from './constants.js';
import { daysBetween } from './time.js';

export const idSchema = z.string().uuid();
export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, 'Not a real calendar date');
export const localTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm');
export const instantSchema = z.iso.datetime({ offset: true }).transform((s) => new Date(s));
export const localeSchema = z.enum(LOCALES);

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
/** E.164-ish: + and 8..15 digits (spaces/dashes tolerated and stripped). */
export const phoneSchema = z
  .string()
  .trim()
  .max(32)
  .transform((s) => s.replace(/[\s\-()]/g, ''))
  .pipe(z.string().regex(/^\+\d{8,15}$/, 'Use international format, e.g. +380501234567'));
const personNameSchema = z.string().trim().min(2).max(100);

export const signUpSchema = z.object({
  email: emailSchema,
  password: z.string().min(10).max(128),
  fullName: personNameSchema,
  phone: phoneSchema,
  locale: localeSchema.default('uk'),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const availabilityQuerySchema = z.object({
  clinicId: idSchema,
  serviceId: idSchema,
  doctorId: idSchema.optional(),
  fromDate: localDateSchema.optional(),
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

export const holdSlotSchema = z.object({
  clinicId: idSchema,
  doctorId: idSchema,
  serviceId: idSchema,
  startsAt: instantSchema,
});
export type HoldSlotInput = z.infer<typeof holdSlotSchema>;

export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_\-:.]+$/);

export const confirmBookingSchema = z.object({
  appointmentId: idSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type ConfirmBookingInput = z.infer<typeof confirmBookingSchema>;

export const rescheduleSchema = z.object({
  appointmentId: idSchema,
  newStartsAt: instantSchema,
  expectedVersion: z.number().int().min(1).optional(),
});
export type RescheduleInput = z.infer<typeof rescheduleSchema>;

export const cancelSchema = z.object({
  appointmentId: idSchema,
  reason: z.string().trim().max(500).optional(),
});

export const joinWaitlistSchema = z
  .object({
    doctorId: idSchema,
    serviceId: idSchema,
    fromDate: localDateSchema,
    toDate: localDateSchema,
  })
  .superRefine((v, ctx) => {
    const span = daysBetween(v.fromDate, v.toDate);
    if (span < 0) ctx.addIssue({ code: 'custom', path: ['toDate'], message: 'toDate before fromDate' });
    else if (span > MAX_WAITLIST_RANGE_DAYS)
      ctx.addIssue({
        code: 'custom',
        path: ['toDate'],
        message: `Range is limited to ${MAX_WAITLIST_RANGE_DAYS} days`,
      });
  });
export type JoinWaitlistInput = z.infer<typeof joinWaitlistSchema>;

export const respondOfferSchema = z.object({ offerId: idSchema, accept: z.boolean() });

const weekdaySchema = z.number().int().min(1).max(7);
const stepAligned = (t: string): boolean => {
  const [h, m] = t.split(':').map(Number);
  return ((h ?? 0) * 60 + (m ?? 0)) % SLOT_STEP_MINUTES === 0;
};
const alignedTime = localTimeSchema.refine(stepAligned, `Must be a multiple of ${SLOT_STEP_MINUTES} min`);

export const scheduleTemplateSchema = z
  .object({
    doctorId: idSchema,
    clinicId: idSchema,
    weekday: weekdaySchema,
    startLocal: alignedTime,
    endLocal: alignedTime,
    breakStartLocal: alignedTime.nullable().default(null),
    breakEndLocal: alignedTime.nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (v.startLocal >= v.endLocal)
      ctx.addIssue({ code: 'custom', path: ['endLocal'], message: 'End must be after start' });
    const hasBreak = v.breakStartLocal !== null || v.breakEndLocal !== null;
    if (hasBreak) {
      if (v.breakStartLocal === null || v.breakEndLocal === null)
        ctx.addIssue({ code: 'custom', path: ['breakEndLocal'], message: 'Both break bounds required' });
      else if (
        !(v.startLocal <= v.breakStartLocal && v.breakStartLocal < v.breakEndLocal && v.breakEndLocal <= v.endLocal)
      )
        ctx.addIssue({ code: 'custom', path: ['breakStartLocal'], message: 'Break must sit inside working hours' });
    }
  });
export type ScheduleTemplateInput = z.infer<typeof scheduleTemplateSchema>;

export const EXCEPTION_KINDS = ['vacation', 'sick', 'day_off', 'extra_day', 'custom_hours'] as const;
export const scheduleExceptionSchema = z
  .object({
    doctorId: idSchema,
    localDate: localDateSchema,
    kind: z.enum(EXCEPTION_KINDS),
    clinicId: idSchema.optional(),
    startLocal: alignedTime.optional(),
    endLocal: alignedTime.optional(),
    breakStartLocal: alignedTime.optional(),
    breakEndLocal: alignedTime.optional(),
  })
  .superRefine((v, ctx) => {
    const needsHours = v.kind === 'extra_day' || v.kind === 'custom_hours';
    if (needsHours) {
      if (!v.startLocal || !v.endLocal || !v.clinicId)
        ctx.addIssue({ code: 'custom', path: ['startLocal'], message: 'clinic, start and end are required' });
      else if (v.startLocal >= v.endLocal)
        ctx.addIssue({ code: 'custom', path: ['endLocal'], message: 'End must be after start' });
    }
  });
export type ScheduleExceptionInput = z.infer<typeof scheduleExceptionSchema>;

export const markSickSchema = z.object({ doctorId: idSchema, localDate: localDateSchema });

export const reportPeriodSchema = z
  .object({ from: localDateSchema, to: localDateSchema, clinicId: idSchema.optional() })
  .superRefine((v, ctx) => {
    const span = daysBetween(v.from, v.to);
    if (span < 0) ctx.addIssue({ code: 'custom', path: ['to'], message: 'to before from' });
    else if (span > 366) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Period is limited to 366 days' });
  });
export type ReportPeriod = z.infer<typeof reportPeriodSchema>;

export const registrarBookingSchema = z.object({
  clinicId: idSchema,
  doctorId: idSchema,
  serviceId: idSchema,
  startsAt: instantSchema,
  patient: z.union([
    z.object({ patientId: idSchema }),
    z.object({ fullName: personNameSchema, phone: phoneSchema, email: emailSchema.optional() }),
  ]),
});

export const serviceDurationSchema = z
  .number()
  .int()
  .min(MIN_SERVICE_MINUTES)
  .max(MAX_SERVICE_MINUTES)
  .refine((n) => n % SLOT_STEP_MINUTES === 0, `Multiple of ${SLOT_STEP_MINUTES}`);

export const paginationSchema = z.object({
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).max(10_000).default(0),
});
