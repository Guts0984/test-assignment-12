'use client';

import { useState } from 'react';
import { useMutation } from 'urql';
import { useTranslations } from 'next-intl';
import { graphql } from '@/shared/api';
import { errorCode } from '@/shared/api';
import { Button, ErrorNote } from '@/shared/ui';
import { SlotButton, useAvailability } from '@/entities/slot';

const RescheduleDocument = graphql(`
  mutation RescheduleAppointment($input: RescheduleInput!) {
    rescheduleAppointment(input: $input) {
      id
      startsAt
      version
    }
  }
`);

/** Pick a new time for the same doctor and service; the move is one atomic server operation. */
export const RescheduleAppointment = ({
  id,
  version,
  clinicId,
  serviceId,
  doctorId,
  doctorName,
  onDone,
}: {
  id: string;
  version: number;
  clinicId: string;
  serviceId: string;
  doctorId: string;
  doctorName: string;
  onDone: () => void;
}) => {
  const t = useTranslations('cabinet');
  const c = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [, move] = useMutation(RescheduleDocument);
  const { availability, fetching, refetch } = useAvailability({
    clinicId: open ? clinicId : '',
    serviceId,
    doctorId,
  });

  if (!open)
    return (
      <Button variant="secondary" onClick={() => setOpen(true)} data-testid="reschedule-open">
        {t('reschedule')}
      </Button>
    );
  const byDay = new Map<
    string,
    typeof availability extends null ? never : NonNullable<typeof availability>['slots']
  >();
  for (const s of availability?.slots ?? [])
    byDay.set(s.localDate, [...(byDay.get(s.localDate) ?? []), s]);
  return (
    <div className="w-full rounded-md bg-slate-50 p-3" role="group" aria-label={t('pickNewTime')}>
      <p className="mb-2 text-sm font-medium">{t('pickNewTime')}</p>
      {fetching && !availability && <p>{c('loading')}</p>}
      <ErrorNote code={code} />
      <div className="max-h-64 overflow-y-auto">
        {[...byDay.entries()].slice(0, 7).map(([day, slots]) => (
          <div key={day} className="mb-2">
            <h4 className="text-xs font-semibold text-slate-600">{day}</h4>
            <div className="flex flex-wrap gap-1">
              {slots.map((s) => (
                <SlotButton
                  key={s.startsAt}
                  slot={s}
                  doctorName={doctorName}
                  showDoctor={false}
                  onPick={async () => {
                    setCode(null);
                    const r = await move({
                      input: {
                        appointmentId: id,
                        newStartsAt: s.startsAt,
                        expectedVersion: version,
                      },
                    });
                    if (r.error) {
                      setCode(errorCode(r.error));
                      refetch();
                    } else {
                      setOpen(false);
                      onDone();
                    }
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <Button variant="ghost" onClick={() => setOpen(false)}>
        {c('cancel')}
      </Button>
    </div>
  );
};
