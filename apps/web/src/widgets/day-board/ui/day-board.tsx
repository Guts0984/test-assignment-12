'use client';

import { useEffect } from 'react';
import { useQuery, useSubscription } from 'urql';
import { useTranslations } from 'next-intl';
import { graphql } from '@/shared/api';
import { Badge, Card, Spinner } from '@/shared/ui';
import { useFormat } from '@/shared/lib';
import { APPOINTMENT_FIELDS_DOC } from '@/entities/appointment';
import { AttendanceActions } from '@/features/attendance';
import { MarkSick } from '@/features/schedule-admin';

void APPOINTMENT_FIELDS_DOC;

const BoardDocument = graphql(`
  query ClinicBoard($clinicId: ID!, $date: String!) {
    clinicBoard(clinicId: $clinicId, date: $date) {
      ...AppointmentFields
    }
  }
`);
const BoardChangedDocument = graphql(`
  subscription BoardChanged($clinicId: ID!) {
    clinicAppointmentChanged(clinicId: $clinicId) {
      id
      status
    }
  }
`);

const TONE = {
  expected: 'sky',
  late: 'amber',
  arrived: 'green',
  with_doctor: 'green',
  done: 'slate',
  no_show: 'rose',
  cancelled: 'slate',
} as const;

/** The registrar's day: who is expected, late, here, with the doctor; updates live. */
export const DayBoard = ({ clinicId, date }: { clinicId: string; date: string }) => {
  const t = useTranslations('registrar');
  const b = useTranslations('board');
  const f = useFormat();
  const [{ data, fetching }, refetch] = useQuery({
    query: BoardDocument,
    variables: { clinicId, date },
    requestPolicy: 'cache-and-network',
  });
  const [ev] = useSubscription({ query: BoardChangedDocument, variables: { clinicId } });
  const stamp = ev.data?.clinicAppointmentChanged;
  useEffect(() => {
    if (stamp) refetch({ requestPolicy: 'network-only' });
  }, [stamp?.id, stamp?.status]);
  const items = data?.clinicBoard ?? [];
  const doctors = [...new Map(items.map((a) => [a.doctorId, a.doctor.fullName])).entries()];
  const reload = (): void => refetch({ requestPolicy: 'network-only' });
  if (!data && fetching) return <Spinner />;
  return (
    <div className="flex flex-col gap-4">
      {items.length === 0 && (
        <p data-testid="board-empty" className="text-sm text-slate-700">
          {t('empty')}
        </p>
      )}
      <ul className="flex flex-col gap-2" aria-label={t('boardTitle')}>
        {items.map((a) => (
          <li key={a.id}>
            <Card
              as="div"
              data-testid="board-item"
              data-status={a.status}
              data-state={a.boardState}
              className="flex flex-wrap items-center justify-between gap-3"
            >
              <div>
                <p className="font-medium tabular-nums">
                  {f.time(a.startsAt, a.clinic.timeZone)} · {a.patient?.fullName}
                </p>
                <p className="text-sm text-slate-700">{a.doctor.fullName}</p>
              </div>
              <Badge tone={TONE[a.boardState]}>{b(a.boardState)}</Badge>
              <div className="flex flex-wrap gap-2">
                <AttendanceActions id={a.id} status={a.status} role="registrar" onDone={reload} />
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {doctors.length > 0 && (
        <section aria-label={t('sick')} className="flex flex-col gap-2">
          {doctors.map(([id, name]) => (
            <div key={id} className="flex flex-wrap items-start gap-3">
              <span className="min-w-40 text-sm font-medium">{name}</span>
              <MarkSick doctorId={id} localDate={date} onDone={reload} />
            </div>
          ))}
        </section>
      )}
    </div>
  );
};
