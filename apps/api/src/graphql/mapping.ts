import type { Appointment } from '@clinic/domain';
import { BoardStateEnum } from './types.js';

type Row = Record<string, unknown>;

export const boardState = (status: string, startsAt: Date, endsAt: Date, now: Date): BoardStateEnum => {
  switch (status) {
    case 'cancelled':
      return BoardStateEnum.cancelled;
    case 'no_show':
      return BoardStateEnum.no_show;
    case 'completed':
      return BoardStateEnum.done;
    case 'checked_in':
      return now.getTime() >= startsAt.getTime() ? BoardStateEnum.with_doctor : BoardStateEnum.arrived;
    default:
      return now.getTime() > startsAt.getTime() ? BoardStateEnum.late : BoardStateEnum.expected;
  }
};

/** A domain row (camelCase) or a raw SQL row (snake_case) → the shape the Appointment type resolves from. */
export const toAppointment = (a: Appointment, now: Date = new Date()) => ({
  id: a.id,
  status: a.status,
  kind: a.kind,
  startsAt: a.startsAt,
  endsAt: a.endsAt,
  localDate: a.localDate,
  holdExpiresAt: a.holdExpiresAt,
  priceMinor: a.priceMinor,
  currency: a.currency,
  version: a.version,
  cancelledLate: a.cancelledLate,
  createdAt: a.createdAt,
  boardState: boardState(a.status, a.startsAt, a.endsAt, now),
  doctorId: a.doctorId,
  clinicId: a.clinicId,
  serviceId: a.serviceId,
  patientId: a.patientId,
});

export const appointmentFromSql = (x: Row, now: Date = new Date()) =>
  toAppointment(
    {
      id: String(x['id']),
      status: String(x['status']),
      kind: String(x['kind']),
      startsAt: new Date(String(x['starts_at'])),
      endsAt: new Date(String(x['ends_at'])),
      localDate: String(x['local_date']),
      holdExpiresAt: x['hold_expires_at'] ? new Date(String(x['hold_expires_at'])) : null,
      priceMinor: Number(x['price_minor']),
      currency: String(x['currency']),
      version: Number(x['version']),
      cancelledLate: Boolean(x['cancelled_late']),
      createdAt: new Date(String(x['created_at'])),
      doctorId: String(x['doctor_id']),
      clinicId: String(x['clinic_id']),
      serviceId: String(x['service_id']),
      patientId: String(x['patient_id']),
    } as unknown as Appointment,
    now,
  );

export const APPOINTMENT_COLUMNS = 'a.id, a.status, a.kind, a.starts_at, a.ends_at, a.local_date::text AS local_date, a.hold_expires_at, a.price_minor, a.currency, a.version, a.cancelled_late, a.created_at, a.doctor_id, a.clinic_id, a.service_id, a.patient_id';
