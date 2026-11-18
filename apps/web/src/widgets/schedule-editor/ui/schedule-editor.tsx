'use client';

import { useQuery } from 'urql';
import { useTranslations } from 'next-intl';
import { graphql } from '@/shared/api';
import { Card, Spinner } from '@/shared/ui';
import { ExceptionForm, RemoveButton, TemplateForm } from '@/features/schedule-admin';

const ScheduleDocument = graphql(`
  query DoctorWeeklySchedule($doctorId: ID!) {
    doctorWeeklySchedule(doctorId: $doctorId) {
      doctorId
      templates {
        doctorId
        clinicId
        weekday
        startLocal
        endLocal
        breakStartLocal
        breakEndLocal
      }
      exceptions {
        doctorId
        localDate
        kind
        clinicId
        startLocal
        endLocal
      }
    }
  }
`);

export const ScheduleEditor = ({ doctorId, clinicId }: { doctorId: string; clinicId: string }) => {
  const t = useTranslations('registrar');
  const w = useTranslations('weekdays');
  const [{ data, fetching }, refetch] = useQuery({
    query: ScheduleDocument,
    variables: { doctorId },
    pause: !doctorId,
    requestPolicy: 'cache-and-network',
  });
  const reload = (): void => refetch({ requestPolicy: 'network-only' });
  if (!doctorId) return null;
  if (!data && fetching) return <Spinner />;
  const s = data?.doctorWeeklySchedule;
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <h2 className="mb-3 text-lg font-semibold">{t('weekly')}</h2>
        <ul className="mb-4 flex flex-col gap-1" data-testid="templates">
          {s?.templates.map((x) => (
            <li key={x.weekday} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="w-28 font-medium">{w(String(x.weekday) as '1')}</span>
              <span className="tabular-nums">
                {x.startLocal}–{x.endLocal}
                {x.breakStartLocal ? ` (${x.breakStartLocal}–${x.breakEndLocal})` : ''}
              </span>
              <RemoveButton
                what={{ type: 'template', doctorId, clinicId, weekday: x.weekday }}
                onDone={reload}
              />
            </li>
          ))}
        </ul>
        <TemplateForm doctorId={doctorId} clinicId={clinicId} onDone={reload} />
      </Card>
      <Card>
        <h2 className="mb-3 text-lg font-semibold">{t('exceptions')}</h2>
        <ul className="mb-4 flex flex-col gap-1" data-testid="exceptions">
          {s?.exceptions.map((x) => (
            <li key={x.localDate} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="tabular-nums">{x.localDate}</span>
              <span>{x.kind === 'sick' ? t('sickKind') : t(x.kind as 'vacation')}</span>
              {x.startLocal && (
                <span className="tabular-nums">
                  {x.startLocal}–{x.endLocal}
                </span>
              )}
              <RemoveButton
                what={{ type: 'exception', doctorId, localDate: x.localDate }}
                onDone={reload}
              />
            </li>
          ))}
        </ul>
        <ExceptionForm doctorId={doctorId} clinicId={clinicId} onDone={reload} />
      </Card>
    </div>
  );
};
