import type { Locale } from '@clinic/shared';

export type AppointmentView = {
  id: string;
  status: string;
  version: number;
  startsAt: Date;
  endsAt: Date;
  clinicId: string;
  doctorId: string;
  localDate: string;
  patientId: string;
  patientName: string;
  patientEmail: string | null;
  patientUserId: string | null;
  locale: Locale;
  doctorName: string;
  serviceNames: Record<Locale, string>;
  clinicCity: string;
  timeZone: string;
  currency: 'UAH' | 'PLN';
  priceMinor: number;
};

type Queryable = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

/** One query for everything an email or reminder needs. `q` is a pool or a transaction client. */
export const loadAppointmentView = async (
  q: Queryable,
  id: string,
): Promise<AppointmentView | null> => {
  const r = await q.query(
    `SELECT a.id, a.status, a.version, a.starts_at, a.ends_at, a.clinic_id, a.doctor_id, a.local_date::text AS local_date,
            a.price_minor, a.currency, p.id AS patient_id, p.full_name, p.email, p.user_id, p.locale,
            d.full_name AS doctor_name, s.name_uk, s.name_en, s.name_pl, c.city, c.time_zone
     FROM appointments a
     JOIN patients p ON p.id = a.patient_id
     JOIN doctors d ON d.id = a.doctor_id
     JOIN services s ON s.id = a.service_id
     JOIN clinics c ON c.id = a.clinic_id
     WHERE a.id = $1`,
    [id],
  );
  const x = r.rows[0];
  if (!x) return null;
  return {
    id: String(x['id']),
    status: String(x['status']),
    version: Number(x['version']),
    startsAt: new Date(x['starts_at'] as string | Date),
    endsAt: new Date(x['ends_at'] as string | Date),
    clinicId: String(x['clinic_id']),
    doctorId: String(x['doctor_id']),
    localDate: String(x['local_date']),
    patientId: String(x['patient_id']),
    patientName: String(x['full_name']),
    patientEmail: x['email'] ? String(x['email']) : null,
    patientUserId: x['user_id'] ? String(x['user_id']) : null,
    locale: String(x['locale']) as Locale,
    doctorName: String(x['doctor_name']),
    serviceNames: { uk: String(x['name_uk']), en: String(x['name_en']), pl: String(x['name_pl']) },
    clinicCity: String(x['city']),
    timeZone: String(x['time_zone']),
    currency: String(x['currency']) as 'UAH' | 'PLN',
    priceMinor: Number(x['price_minor']),
  };
};
export type { Queryable };
