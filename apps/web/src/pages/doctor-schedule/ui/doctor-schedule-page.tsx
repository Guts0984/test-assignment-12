'use client';

import { useEffect } from 'react';
import { useQuery, useSubscription } from 'urql';
import { useLocale, useTranslations } from 'next-intl';
import { addDays, isoWeekday, localDateOf } from '@clinic/shared';
import { graphql } from '@/shared/api';
import { PageTitle, Spinner, TextField } from '@/shared/ui';
import { useUrlState } from '@/shared/lib';
import { formatLocalDate } from '@/shared/lib';
import { AppointmentCard, APPOINTMENT_FIELDS_DOC } from '@/entities/appointment';
import { AttendanceActions } from '@/features/attendance';

void APPOINTMENT_FIELDS_DOC;

const WeekDocument = graphql(`query DoctorWeek($from: String!) { doctorSchedule(fromDate: $from, days: 7) { ...AppointmentFields } }`);
const ChangedDocument = graphql(`subscription DoctorChanged { doctorAppointmentChanged { id status } }`);
const KEYS = ['from'] as const;

/** The doctor's day and week across every clinic they work in; no other doctor's patients are ever loaded. */
export const DoctorSchedulePage = () => {
  const t = useTranslations('doctor');
  const locale = useLocale();
  const [q, setQ] = useUrlState(KEYS);
  const today = localDateOf(new Date(), 'Europe/Kyiv');
  const monday = addDays(today, 1 - isoWeekday(today));
  const from = q.from || monday;
  const [{ data, fetching }, refetch] = useQuery({ query: WeekDocument, variables: { from }, requestPolicy: 'cache-and-network' });
  const [ev] = useSubscription({ query: ChangedDocument });
  const stamp = ev.data?.doctorAppointmentChanged;
  useEffect(() => { if (stamp) refetch({ requestPolicy: 'network-only' }); }, [stamp?.id, stamp?.status]);
  const byDay = new Map<string, NonNullable<typeof data>['doctorSchedule']>();
  for (const a of data?.doctorSchedule ?? []) byDay.set(a.localDate, [...(byDay.get(a.localDate) ?? []), a]);
  return (
    <>
      <PageTitle>{t('title')}</PageTitle>
      <TextField className="mb-4 max-w-xs" label={t('from')} type="date" value={from} onChange={(e) => setQ({ from: e.target.value })} />
      {!data && fetching && <Spinner />}
      {data && byDay.size === 0 && <p className="text-sm text-slate-700" data-testid="doctor-empty">{t('empty')}</p>}
      <div className="flex flex-col gap-6">
        {[...byDay.entries()].map(([day, list]) => (
          <section key={day} aria-label={day}>
            <h2 className="mb-2 font-semibold">{formatLocalDate(day, locale, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
            <div className="flex flex-col gap-2">
              {list.map((a) => <AppointmentCard key={a.id} a={a} showPatient actions={<AttendanceActions id={a.id} status={a.status} role="doctor" onDone={() => refetch({ requestPolicy: 'network-only' })} />} />)}
            </div>
          </section>
        ))}
      </div>
    </>
  );
};
