import { graphql } from '@/shared/api';
import type { AppointmentFieldsFragment } from '@/shared/api';

export const APPOINTMENT_FIELDS_DOC = graphql(`
  fragment AppointmentFields on Appointment {
    id status kind startsAt endsAt localDate holdExpiresAt priceMinor currency version cancelledLate boardState
    doctorId clinicId serviceId patientId
    doctor { id fullName }
    clinic { id city timeZone currency }
    service { id nameUk nameEn namePl durationMin }
    patient { id fullName phone }
  }
`);

export type AppointmentView = AppointmentFieldsFragment;
