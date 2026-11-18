'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatLocalDate } from '@/shared/lib';
import type { SlotData } from '../model/use-availability';

/** One bookable time: a real button (focusable, Enter/Space), labelled with the date, the clinic's wall time and the doctor (a screen reader hears 'Thu 26 Nov, 09:15, Dr X'). */
export const SlotButton = ({
  slot,
  doctorName,
  showDoctor,
  selected,
  onPick,
}: {
  slot: SlotData;
  doctorName: string;
  showDoctor: boolean;
  selected?: boolean;
  onPick: (s: SlotData) => void;
}) => {
  const t = useTranslations('search');
  const locale = useLocale();
  return (
    <button
      type="button"
      onClick={() => onPick(slot)}
      aria-pressed={selected}
      aria-label={t('slotLabel', {
        date: formatLocalDate(slot.localDate, locale),
        time: slot.localTime,
        doctor: doctorName,
      })}
      data-testid="slot"
      data-start={slot.startsAt}
      data-doctor={slot.doctorId}
      className={`rounded-md border px-2 py-1 text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 ${selected ? 'border-sky-700 bg-sky-700 text-white' : 'border-slate-300 bg-white hover:border-sky-600 hover:bg-sky-50'}`}
    >
      {slot.localTime}
      {showDoctor && (
        <span className="ml-1 text-xs opacity-70">{doctorName.split(' ').slice(-1)[0]}</span>
      )}
    </button>
  );
};
