import { sql } from 'drizzle-orm';
import type { Queryable } from '../client.js';

export type AvailabilityParams = {
  clinicId: string;
  serviceId: string;
  doctorId?: string | undefined;
  /** Window of busy time to load (instants). Anything overlapping it is returned. */
  windowStart: Date;
  windowEnd: Date;
  /** First local date and number of dates for exceptions. */
  fromDate: string;
  toDate: string;
  now: Date;
};

export type AvailabilityInputs = {
  clinic: { id: string; timeZone: string; currency: 'UAH' | 'PLN' } | null;
  service: { id: string; durationMin: number; needsUltrasound: boolean; priceMinor: number } | null;
  doctors: { id: string; fullName: string; specialty: string }[];
  templates: {
    doctorId: string;
    weekday: number;
    startLocal: string;
    endLocal: string;
    breakStartLocal: string | null;
    breakEndLocal: string | null;
  }[];
  exceptions: {
    doctorId: string;
    localDate: string;
    kind: string;
    clinicId: string | null;
    startLocal: string | null;
    endLocal: string | null;
    breakStartLocal: string | null;
    breakEndLocal: string | null;
  }[];
  /** Doctor busy intervals (visit + preparation). */
  doctorBusy: { doctorId: string; startsAt: Date; occupiedUntil: Date }[];
  /** Ultrasound room busy intervals; empty unless the service needs the room. */
  roomBusy: { startsAt: Date; occupiedUntil: Date }[];
};

type Row = Record<string, unknown>;
const rowsOf = (r: { rows: unknown[] }): Row[] => r.rows as Row[];
const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const ms = (v: unknown): Date => new Date(Number(v));

/**
 * Raw inputs for the free-time grid: working rules + busy intervals, in 5 queries
 * whose cost does not depend on how many doctors there are.
 * Expired regular holds are ignored here (they are free), waitlist offers keep blocking.
 */
// A visit lasts at most 90 min + 5 min prep, so anything that overlaps the window starts at most a
// day before it. The extra `starts_at >` bound lets Postgres use the (doctor_id, starts_at) index.
export const loadAvailabilityInputs = async (
  db: Queryable,
  p: AvailabilityParams,
): Promise<AvailabilityInputs> => {
  const doctorFilter = p.doctorId ? sql`AND d.id = ${p.doctorId}::uuid` : sql``;

  const [clinicRes, serviceRes, doctorRes] = await Promise.all([
    db.execute(sql`SELECT id, time_zone, currency FROM clinics WHERE id = ${p.clinicId}::uuid`),
    db.execute(sql`
      SELECT s.id, s.duration_min, s.needs_ultrasound, cs.price_minor
      FROM services s JOIN clinic_services cs ON cs.service_id = s.id AND cs.clinic_id = ${p.clinicId}::uuid
      WHERE s.id = ${p.serviceId}::uuid`),
    db.execute(sql`
      SELECT d.id, d.full_name, d.specialty
      FROM doctors d
      JOIN doctor_services ds ON ds.doctor_id = d.id AND ds.service_id = ${p.serviceId}::uuid
      WHERE (
        EXISTS (SELECT 1 FROM schedule_templates t WHERE t.doctor_id = d.id AND t.clinic_id = ${p.clinicId}::uuid)
        OR EXISTS (SELECT 1 FROM schedule_exceptions e WHERE e.doctor_id = d.id AND e.clinic_id = ${p.clinicId}::uuid
                   AND e.local_date BETWEEN ${p.fromDate}::date AND ${p.toDate}::date)
      ) ${doctorFilter}
      ORDER BY d.full_name, d.id`),
  ]);

  const clinicRow = rowsOf(clinicRes)[0];
  const serviceRow = rowsOf(serviceRes)[0];
  const doctors = rowsOf(doctorRes).map((r) => ({
    id: str(r['id']),
    fullName: str(r['full_name']),
    specialty: str(r['specialty']),
  }));
  const clinic = clinicRow
    ? {
        id: str(clinicRow['id']),
        timeZone: str(clinicRow['time_zone']),
        currency: str(clinicRow['currency']) as 'UAH' | 'PLN',
      }
    : null;
  const service = serviceRow
    ? {
        id: str(serviceRow['id']),
        durationMin: Number(serviceRow['duration_min']),
        needsUltrasound: Boolean(serviceRow['needs_ultrasound']),
        priceMinor: Number(serviceRow['price_minor']),
      }
    : null;
  if (!clinic || !service || doctors.length === 0) {
    return {
      clinic,
      service,
      doctors,
      templates: [],
      exceptions: [],
      doctorBusy: [],
      roomBusy: [],
    };
  }

  const ids = sql.join(
    doctors.map((d) => sql`${d.id}::uuid`),
    sql`, `,
  );
  const busyFilter = sql`
    status <> 'cancelled'
    AND NOT (status = 'held' AND kind = 'regular' AND hold_expires_at <= ${p.now.toISOString()}::timestamptz)
    AND starts_at < ${p.windowEnd.toISOString()}::timestamptz
    AND starts_at > ${p.windowStart.toISOString()}::timestamptz - interval '1 day'
    AND occupied_until > ${p.windowStart.toISOString()}::timestamptz`;

  const [tplRes, excRes, busyRes, roomRes] = await Promise.all([
    db.execute(sql`
      SELECT doctor_id, weekday, start_local::text, end_local::text, break_start_local::text, break_end_local::text
      FROM schedule_templates WHERE clinic_id = ${p.clinicId}::uuid AND doctor_id IN (${ids})`),
    db.execute(sql`
      SELECT doctor_id, local_date::text, kind, clinic_id, start_local::text, end_local::text,
             break_start_local::text, break_end_local::text
      FROM schedule_exceptions
      WHERE doctor_id IN (${ids}) AND local_date BETWEEN ${p.fromDate}::date AND ${p.toDate}::date`),
    db.execute(sql`
      SELECT doctor_id, (extract(epoch FROM starts_at) * 1000)::bigint AS s_ms, (extract(epoch FROM occupied_until) * 1000)::bigint AS e_ms FROM appointments
      WHERE doctor_id IN (${ids}) AND ${busyFilter}`),
    service.needsUltrasound
      ? db.execute(sql`
          SELECT (extract(epoch FROM a.starts_at) * 1000)::bigint AS s_ms, (extract(epoch FROM a.occupied_until) * 1000)::bigint AS e_ms FROM appointments a
          JOIN rooms r ON r.id = a.room_id AND r.clinic_id = ${p.clinicId}::uuid AND r.kind = 'ultrasound'
          WHERE a.status <> 'cancelled'
            AND NOT (a.status = 'held' AND a.kind = 'regular' AND a.hold_expires_at <= ${p.now.toISOString()}::timestamptz)
            AND a.starts_at < ${p.windowEnd.toISOString()}::timestamptz
            AND a.starts_at > ${p.windowStart.toISOString()}::timestamptz - interval '1 day'
            AND a.occupied_until > ${p.windowStart.toISOString()}::timestamptz`)
      : Promise.resolve({ rows: [] as unknown[] }),
  ]);

  return {
    clinic,
    service,
    doctors,
    templates: rowsOf(tplRes).map((r) => ({
      doctorId: str(r['doctor_id']),
      weekday: Number(r['weekday']),
      startLocal: str(r['start_local']).slice(0, 5),
      endLocal: str(r['end_local']).slice(0, 5),
      breakStartLocal: strOrNull(r['break_start_local'])?.slice(0, 5) ?? null,
      breakEndLocal: strOrNull(r['break_end_local'])?.slice(0, 5) ?? null,
    })),
    exceptions: rowsOf(excRes).map((r) => ({
      doctorId: str(r['doctor_id']),
      localDate: str(r['local_date']),
      kind: str(r['kind']),
      clinicId: strOrNull(r['clinic_id']),
      startLocal: strOrNull(r['start_local'])?.slice(0, 5) ?? null,
      endLocal: strOrNull(r['end_local'])?.slice(0, 5) ?? null,
      breakStartLocal: strOrNull(r['break_start_local'])?.slice(0, 5) ?? null,
      breakEndLocal: strOrNull(r['break_end_local'])?.slice(0, 5) ?? null,
    })),
    doctorBusy: rowsOf(busyRes).map((r) => ({
      doctorId: str(r['doctor_id']),
      startsAt: ms(r['s_ms']),
      occupiedUntil: ms(r['e_ms']),
    })),
    roomBusy: rowsOf(roomRes).map((r) => ({
      startsAt: ms(r['s_ms']),
      occupiedUntil: ms(r['e_ms']),
    })),
  };
};
