'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Card, ErrorNote, Spinner } from '@/shared/ui';
import { errorCode } from '@/shared/api';
import { formatLocalDate } from '@/shared/lib';
import { SlotButton, useAvailability, type SlotData } from '@/entities/slot';

export type PickedSlot = { slot: SlotData; doctorName: string; durationMin: number; priceMinor: number; currency: 'UAH' | 'PLN'; timeZone: string };

/**
 * Fourteen days of free times for one service in one clinic. Times are the CLINIC's wall-clock times
 * (never converted to the browser's zone) and the grid keeps itself current through the live subscription.
 */
export const SlotGrid = ({ clinicId, clinicLabel, serviceId, doctorId, selectedStart, onPick }: { clinicId: string; clinicLabel: string; serviceId: string; doctorId: string; selectedStart?: string; onPick: (p: PickedSlot) => void }) => {
  const t = useTranslations('search');
  const locale = useLocale();
  const { availability, fetching, error } = useAvailability({ clinicId, serviceId, doctorId });
  if (!clinicId || !serviceId) return null;
  if (!availability) return fetching ? <p aria-busy="true"><Spinner /></p> : <ErrorNote code={errorCode(error)} />;

  const names = new Map(availability.doctors.map((d) => [d.id, d.fullName]));
  const byDay = new Map<string, SlotData[]>();
  for (const s of availability.slots) byDay.set(s.localDate, [...(byDay.get(s.localDate) ?? []), s]);
  const multiDoctor = availability.doctors.length > 1 && !doctorId;

  return (
    <section aria-labelledby="grid-title" data-testid="slot-grid">
      <h2 id="grid-title" className="text-lg font-semibold">{t('freeTimes')}</h2>
      <p className="mb-3 text-xs text-slate-600">{t('clinicTime', { city: clinicLabel, tz: availability.timeZone })} · {t('live')}</p>
      {byDay.size === 0 && <p role="status" data-testid="no-slots" className="text-sm text-slate-700">{t('noSlots')}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[...byDay.entries()].map(([day, slots]) => (
          <Card key={day} as="div" className="p-3" data-day={day}>
            <h3 className="mb-2 text-sm font-semibold">{formatLocalDate(day, locale)}</h3>
            <div className="flex flex-wrap gap-1">
              {slots.map((s) => (
                <SlotButton key={`${s.doctorId}-${s.startsAt}`} slot={s} doctorName={names.get(s.doctorId) ?? ''} showDoctor={multiDoctor} selected={selectedStart === s.startsAt}
                  onPick={() => onPick({ slot: s, doctorName: names.get(s.doctorId) ?? '', durationMin: availability.durationMin, priceMinor: availability.priceMinor, currency: availability.currency, timeZone: availability.timeZone })} />
              ))}
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
};
