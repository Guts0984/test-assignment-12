import { sql } from 'drizzle-orm';
import type { Queryable } from '../client.js';

export type ReportParams = { from: string; to: string; clinicId?: string | undefined };

export type Report = {
  utilization: {
    doctorId: string;
    doctorName: string;
    clinicId: string;
    workMinutes: number;
    bookedMinutes: number;
    percent: number;
  }[];
  rates: {
    bookings: number;
    noShows: number;
    lateCancels: number;
    noShowPercent: number;
    lateCancelPercent: number;
  };
  waitlist: { offered: number; accepted: number; acceptedPercent: number };
  revenue: {
    serviceId: string;
    serviceCode: string;
    nameUk: string;
    nameEn: string;
    namePl: string;
    currency: 'UAH' | 'PLN';
    revenueMinor: number;
    visits: number;
  }[];
};

type Row = Record<string, unknown>;
const pct = (num: number, den: number): number =>
  den === 0 ? 0 : Math.round((num / den) * 1000) / 10;

/**
 * Network report for [from, to] (clinic-local dates, inclusive).
 * - utilization: minutes of live visits (booked/checked-in/completed/no-show) ÷ working minutes
 *   derived from weekly templates, with exceptions applied (vacation/sick/day-off remove the day,
 *   extra-day/custom-hours replace it)
 * - rates: no-shows and late cancels as a share of visits that were ever booked
 * - waitlist: offers created in the period and how many were accepted
 * - revenue: completed visits per service and currency (currencies are never summed)
 */
export const loadReport = async (db: Queryable, p: ReportParams): Promise<Report> => {
  const clinic = p.clinicId ?? null;
  const [util, rates, wl, rev] = await Promise.all([
    db.execute(sql`
      WITH days AS (
        SELECT d::date AS day FROM generate_series(${p.from}::date, ${p.to}::date, interval '1 day') d
      ),
      work AS (
        SELECT d.day, t.doctor_id, t.clinic_id,
               extract(epoch FROM (t.end_local - t.start_local)) / 60
                 - coalesce(extract(epoch FROM (t.break_end_local - t.break_start_local)) / 60, 0) AS minutes
        FROM days d
        JOIN schedule_templates t ON t.weekday = extract(isodow FROM d.day)::int
        WHERE (${clinic}::uuid IS NULL OR t.clinic_id = ${clinic}::uuid)
          AND NOT EXISTS (
            SELECT 1 FROM schedule_exceptions e WHERE e.doctor_id = t.doctor_id AND e.local_date = d.day)
        UNION ALL
        SELECT e.local_date, e.doctor_id, e.clinic_id,
               extract(epoch FROM (e.end_local - e.start_local)) / 60
                 - coalesce(extract(epoch FROM (e.break_end_local - e.break_start_local)) / 60, 0)
        FROM schedule_exceptions e
        WHERE e.local_date BETWEEN ${p.from}::date AND ${p.to}::date
          AND e.kind IN ('extra_day', 'custom_hours')
          AND (${clinic}::uuid IS NULL OR e.clinic_id = ${clinic}::uuid)
      ),
      w AS (SELECT doctor_id, clinic_id, sum(minutes) AS work_min FROM work GROUP BY 1, 2),
      b AS (
        SELECT doctor_id, clinic_id, sum(extract(epoch FROM (ends_at - starts_at)) / 60) AS booked_min
        FROM appointments
        WHERE local_date BETWEEN ${p.from}::date AND ${p.to}::date
          AND status IN ('booked', 'checked_in', 'completed', 'no_show')
          AND (${clinic}::uuid IS NULL OR clinic_id = ${clinic}::uuid)
        GROUP BY 1, 2
      )
      SELECT w.doctor_id, d.full_name, w.clinic_id, w.work_min, coalesce(b.booked_min, 0) AS booked_min
      FROM w JOIN doctors d ON d.id = w.doctor_id
      LEFT JOIN b ON b.doctor_id = w.doctor_id AND b.clinic_id = w.clinic_id
      ORDER BY d.full_name, w.clinic_id`),
    db.execute(sql`
      SELECT count(*) FILTER (WHERE booked_at IS NOT NULL) AS bookings,
             count(*) FILTER (WHERE status = 'no_show') AS no_shows,
             count(*) FILTER (WHERE status = 'cancelled' AND cancelled_late AND booked_at IS NOT NULL) AS late_cancels
      FROM appointments
      WHERE local_date BETWEEN ${p.from}::date AND ${p.to}::date
        AND (${clinic}::uuid IS NULL OR clinic_id = ${clinic}::uuid)`),
    db.execute(sql`
      SELECT count(*) AS offered, count(*) FILTER (WHERE o.status = 'accepted') AS accepted
      FROM waitlist_offers o
      JOIN appointments a ON a.id = o.appointment_id
      WHERE a.local_date BETWEEN ${p.from}::date AND ${p.to}::date
        AND (${clinic}::uuid IS NULL OR a.clinic_id = ${clinic}::uuid)`),
    db.execute(sql`
      SELECT a.service_id, s.code, s.name_uk, s.name_en, s.name_pl, a.currency, sum(a.price_minor)::bigint AS revenue, count(*) AS visits
      FROM appointments a JOIN services s ON s.id = a.service_id
      WHERE a.local_date BETWEEN ${p.from}::date AND ${p.to}::date AND a.status = 'completed'
        AND (${clinic}::uuid IS NULL OR a.clinic_id = ${clinic}::uuid)
      GROUP BY a.service_id, s.code, s.name_uk, s.name_en, s.name_pl, a.currency
      ORDER BY a.currency, revenue DESC`),
  ]);

  const r0 = (rates.rows as Row[])[0] ?? {};
  const bookings = Number(r0['bookings'] ?? 0);
  const noShows = Number(r0['no_shows'] ?? 0);
  const lateCancels = Number(r0['late_cancels'] ?? 0);
  const w0 = (wl.rows as Row[])[0] ?? {};
  const offered = Number(w0['offered'] ?? 0);
  const accepted = Number(w0['accepted'] ?? 0);

  return {
    utilization: (util.rows as Row[]).map((r) => {
      const workMinutes = Number(r['work_min']);
      const bookedMinutes = Number(r['booked_min']);
      return {
        doctorId: String(r['doctor_id']),
        doctorName: String(r['full_name']),
        clinicId: String(r['clinic_id']),
        workMinutes,
        bookedMinutes,
        percent: pct(bookedMinutes, workMinutes),
      };
    }),
    rates: {
      bookings,
      noShows,
      lateCancels,
      noShowPercent: pct(noShows, bookings),
      lateCancelPercent: pct(lateCancels, bookings),
    },
    waitlist: { offered, accepted, acceptedPercent: pct(accepted, offered) },
    revenue: (rev.rows as Row[]).map((r) => ({
      serviceId: String(r['service_id']),
      serviceCode: String(r['code']),
      nameUk: String(r['name_uk']),
      nameEn: String(r['name_en']),
      namePl: String(r['name_pl']),
      currency: String(r['currency']) as 'UAH' | 'PLN',
      revenueMinor: Number(r['revenue']),
      visits: Number(r['visits']),
    })),
  };
};
