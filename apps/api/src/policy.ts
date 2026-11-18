import type { Actor } from '@clinic/domain';

type Visit = { patientId: string; clinicId: string; doctorId: string };

/**
 * Who may see what. Every resolver, field resolver and subscription event goes through these
 * functions; there is no second copy of the rules. List queries are additionally scoped in SQL so
 * foreign rows are never even loaded.
 */
export const canReadAppointment = (a: Actor | null, v: Visit): boolean => {
  if (!a) return false;
  switch (a.role) {
    case 'patient':
      return !!a.patientId && a.patientId === v.patientId;
    case 'registrar':
      return !!a.clinicId && a.clinicId === v.clinicId;
    case 'doctor':
      return !!a.doctorId && a.doctorId === v.doctorId;
    case 'system':
      return true;
    default:
      return false; // managers see aggregates, not individual visits
  }
};

/** Contact details of a patient: the patient themself and the registrar of the visit's clinic. */
export const canReadPatientContacts = (a: Actor | null, v: Visit): boolean =>
  !!a && ((a.role === 'patient' && a.patientId === v.patientId) || (a.role === 'registrar' && !!a.clinicId && a.clinicId === v.clinicId));

/** Name of the patient on a visit: additionally the visit's own doctor (not other doctors). */
export const canReadPatientName = (a: Actor | null, v: Visit): boolean =>
  canReadPatientContacts(a, v) || (!!a && a.role === 'doctor' && !!a.doctorId && a.doctorId === v.doctorId);

export const isRole = (a: Actor | null, ...roles: Actor['role'][]): boolean => !!a && roles.includes(a.role);
