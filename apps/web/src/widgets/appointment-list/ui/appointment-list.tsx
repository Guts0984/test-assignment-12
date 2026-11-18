'use client';

import { useQuery, useSubscription } from 'urql';
import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { graphql } from '@/shared/api';
import { Spinner } from '@/shared/ui';
import { AppointmentCard, APPOINTMENT_FIELDS_DOC } from '@/entities/appointment';
import { CancelAppointment, RescheduleAppointment } from '@/features/manage-appointment';

void APPOINTMENT_FIELDS_DOC;

const MyAppointmentsDocument = graphql(`
  query MyAppointments($scope: VisitScope!) {
    myAppointments(scope: $scope, limit: 30) { ...AppointmentFields }
  }
`);
const MyChangedDocument = graphql(`subscription MyAppointmentsChanged { myAppointmentChanged { id status } }`);

/** The patient's visits, upcoming or past. Live: a change from another tab or the worker shows up by itself. */
export const AppointmentList = ({ scope, onChanged }: { scope: 'UPCOMING' | 'PAST'; onChanged?: () => void }) => {
  const t = useTranslations('cabinet');
  const [{ data, fetching }, refetch] = useQuery({ query: MyAppointmentsDocument, variables: { scope }, requestPolicy: 'cache-and-network' });
  const [ev] = useSubscription({ query: MyChangedDocument });
  const stamp = ev.data?.myAppointmentChanged;
  useEffect(() => { if (stamp) refetch({ requestPolicy: 'network-only' }); }, [stamp?.id, stamp?.status]);
  const items = data?.myAppointments ?? [];
  const reload = (): void => { refetch({ requestPolicy: 'network-only' }); onChanged?.(); };
  if (!data && fetching) return <Spinner />;
  if (items.length === 0) return <p className="text-sm text-slate-700" data-testid="no-visits">{t('none')}</p>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-slate-600" data-testid="visit-count">{t('count', { count: items.length })}</p>
      {items.map((a) => (
        <AppointmentCard key={a.id} a={a} actions={scope === 'UPCOMING' && (a.status === 'booked' || a.status === 'held') ? (
          <>
            {a.status === 'booked' && <RescheduleAppointment id={a.id} version={a.version} clinicId={a.clinicId} serviceId={a.serviceId} doctorId={a.doctorId} doctorName={a.doctor.fullName} onDone={reload} />}
            <CancelAppointment id={a.id} startsAt={a.startsAt} onDone={reload} />
          </>
        ) : undefined} />
      ))}
    </div>
  );
};
