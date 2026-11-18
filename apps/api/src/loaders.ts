import DataLoader from 'dataloader';
import { sql } from 'drizzle-orm';
import type { Db } from '@clinic/db';
import type { Actor } from '@clinic/domain';
import { APPOINTMENT_COLUMNS } from './graphql/mapping.js';

type Row = Record<string, unknown>;

const byId = <T extends { id: string }>(ids: readonly string[], rows: T[]): (T | null)[] => {
  const m = new Map(rows.map((r) => [r.id, r]));
  return ids.map((i) => m.get(i) ?? null);
};

const idList = (ids: readonly string[]) => sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);

export type DoctorRow = { id: string; fullName: string; specialty: string };
export type ClinicRow = { id: string; code: string; city: string; timeZone: string; currency: 'UAH' | 'PLN' };
export type ServiceRow = { id: string; code: string; specialty: string; nameUk: string; nameEn: string; namePl: string; durationMin: number; needsUltrasound: boolean };
export type PatientRow = { id: string; fullName: string; phone: string; email: string | null; onlineBookingBlockedUntil: Date | null };

export type EventRow = { appointmentId: string; at: Date; type: string; fromStatus: string | null; toStatus: string; actorRole: string; late: boolean; reason: string | null; oldStartsAt: Date | null; newStartsAt: Date | null };

export type Loaders = ReturnType<typeof createLoaders>;

/**
 * Per-request batching: a list of 50 visits with doctor, clinic, service and patient costs one
 * query for the list plus ONE query per relation (not 200), whatever the list length.
 */
/** SQL scope for "which visits may this actor see": the same rule as policy.canReadAppointment, in WHERE form. */
const scopeSql = (actor: Actor | null) => {
  if (!actor) return sql`false`;
  switch (actor.role) {
    case 'patient':
      return actor.patientId ? sql`a.patient_id = ${actor.patientId}::uuid` : sql`false`;
    case 'registrar':
      return actor.clinicId ? sql`a.clinic_id = ${actor.clinicId}::uuid` : sql`false`;
    case 'doctor':
      return actor.doctorId ? sql`a.doctor_id = ${actor.doctorId}::uuid` : sql`false`;
    case 'system':
      return sql`true`;
    default:
      return sql`false`;
  }
};

export const createLoaders = (db: Db, actor: Actor | null = null) => ({
  /** A patient's visits, as far as THIS actor may see them (50 most recent per patient, one query for the whole batch). */
  visits: new DataLoader<string, Row[]>(async (ids) => {
    const r = await db.execute(sql`
      SELECT * FROM (
        SELECT ${sql.raw(APPOINTMENT_COLUMNS)}, row_number() OVER (PARTITION BY a.patient_id ORDER BY a.starts_at DESC) AS rn
        FROM appointments a WHERE a.patient_id IN (${idList(ids)}) AND a.status <> 'held' AND ${scopeSql(actor)}
      ) x WHERE rn <= 50 ORDER BY starts_at DESC`);
    const m = new Map<string, Row[]>();
    for (const x of r.rows as Row[]) {
      const k = String(x['patient_id']);
      m.set(k, [...(m.get(k) ?? []), x]);
    }
    return ids.map((i) => m.get(i) ?? []);
  }),
  doctor: new DataLoader<string, DoctorRow | null>(async (ids) => {
    const r = await db.execute(sql`SELECT id, full_name, specialty FROM doctors WHERE id IN (${idList(ids)})`);
    return byId(ids, (r.rows as Row[]).map((x) => ({ id: String(x['id']), fullName: String(x['full_name']), specialty: String(x['specialty']) })));
  }),
  clinic: new DataLoader<string, ClinicRow | null>(async (ids) => {
    const r = await db.execute(sql`SELECT id, code, city, time_zone, currency FROM clinics WHERE id IN (${idList(ids)})`);
    return byId(ids, (r.rows as Row[]).map((x) => ({ id: String(x['id']), code: String(x['code']), city: String(x['city']), timeZone: String(x['time_zone']), currency: String(x['currency']) as 'UAH' | 'PLN' })));
  }),
  service: new DataLoader<string, ServiceRow | null>(async (ids) => {
    const r = await db.execute(sql`SELECT id, code, specialty, name_uk, name_en, name_pl, duration_min, needs_ultrasound FROM services WHERE id IN (${idList(ids)})`);
    return byId(ids, (r.rows as Row[]).map((x) => ({ id: String(x['id']), code: String(x['code']), specialty: String(x['specialty']), nameUk: String(x['name_uk']), nameEn: String(x['name_en']), namePl: String(x['name_pl']), durationMin: Number(x['duration_min']), needsUltrasound: Boolean(x['needs_ultrasound']) })));
  }),
  events: new DataLoader<string, EventRow[]>(async (ids) => {
    const r = await db.execute(sql`SELECT appointment_id, at, type, from_status, to_status, actor_role, late, reason, old_starts_at, new_starts_at FROM appointment_events WHERE appointment_id IN (${idList(ids)}) ORDER BY at, id`);
    const m = new Map<string, EventRow[]>();
    for (const x of r.rows as Row[]) {
      const k = String(x['appointment_id']);
      const list = m.get(k) ?? [];
      list.push({ appointmentId: k, at: new Date(String(x['at'])), type: String(x['type']), fromStatus: x['from_status'] ? String(x['from_status']) : null, toStatus: String(x['to_status']), actorRole: String(x['actor_role']), late: Boolean(x['late']), reason: x['reason'] ? String(x['reason']) : null, oldStartsAt: x['old_starts_at'] ? new Date(String(x['old_starts_at'])) : null, newStartsAt: x['new_starts_at'] ? new Date(String(x['new_starts_at'])) : null });
      m.set(k, list);
    }
    return ids.map((i) => m.get(i) ?? []);
  }),
  patient: new DataLoader<string, PatientRow | null>(async (ids) => {
    const r = await db.execute(sql`SELECT id, full_name, phone, email, online_booking_blocked_until FROM patients WHERE id IN (${idList(ids)})`);
    return byId(ids, (r.rows as Row[]).map((x) => ({ id: String(x['id']), fullName: String(x['full_name']), phone: String(x['phone']), email: x['email'] ? String(x['email']) : null, onlineBookingBlockedUntil: x['online_booking_blocked_until'] ? new Date(String(x['online_booking_blocked_until'])) : null })));
  }),
});
