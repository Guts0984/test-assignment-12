import { z } from 'zod';

/** Redis pub/sub channel carrying live events from worker and api to every api replica. */
export const EVENTS_CHANNEL = 'clinic:events';

/**
 * Events carry ids only, never personal data: the subscription layer decides, per subscriber,
 * what they may see and re-reads it through the normal authorized resolvers.
 */
export const clinicEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('availability'),
    clinicId: z.string().uuid(),
    doctorId: z.string().uuid(),
    localDate: z.string(),
  }),
  z.object({
    type: z.literal('appointment'),
    appointmentId: z.string().uuid(),
    patientId: z.string().uuid(),
    clinicId: z.string().uuid(),
    doctorId: z.string().uuid(),
  }),
  z.object({ type: z.literal('offer'), offerId: z.string().uuid(), patientId: z.string().uuid() }),
]);
export type ClinicEvent = z.infer<typeof clinicEventSchema>;

export const encodeEvent = (e: ClinicEvent): string => JSON.stringify(e);
export const decodeEvent = (raw: string): ClinicEvent | null => {
  try {
    const r = clinicEventSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
};
