'use client';

import type { ReactNode } from 'react';
import { useFormat } from '@/shared/lib';
import { serviceNameFor } from '../lib/service-name';
import { Card } from '@/shared/ui';
import type { AppointmentView } from '../model/fields';
import { StatusBadge } from './status-badge';
import { AppointmentHistory } from './history';

/** A visit as the patient or staff reads it: time in the CLINIC's zone, price in the CLINIC's currency. */
export const AppointmentCard = ({ a, actions, showPatient }: { a: AppointmentView; actions?: ReactNode; showPatient?: boolean }) => {
  const f = useFormat();
  return (
    <Card as="article" data-testid="appointment" data-id={a.id} data-status={a.status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium text-slate-900">{f.dateTime(a.startsAt, a.clinic.timeZone)}</h3>
        <StatusBadge status={a.status} />
      </div>
      <p className="text-sm text-slate-700">
        {serviceNameFor(a.service, f.locale)} · {a.doctor.fullName} · {a.clinic.city}
      </p>
      {showPatient && a.patient && <p className="text-sm text-slate-700">{a.patient.fullName}{a.patient.phone ? ` · ${a.patient.phone}` : ''}</p>}
      <p className="text-sm text-slate-600">{f.money(a.priceMinor, a.currency)}</p>
      <AppointmentHistory id={a.id} tz={a.clinic.timeZone} />
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </Card>
  );
};
