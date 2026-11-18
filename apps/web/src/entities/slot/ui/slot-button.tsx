'use client';

import type { SlotData } from '../model/use-availability';

/** One bookable time: a real button (focusable, Enter/Space), labelled with the clinic's wall time and doctor. */
export const SlotButton = ({ slot, doctorName, showDoctor, selected, onPick }: { slot: SlotData; doctorName: string; showDoctor: boolean; selected?: boolean; onPick: (s: SlotData) => void }) => (
  <button
    type="button"
    onClick={() => onPick(slot)}
    aria-pressed={selected}
    aria-label={`${slot.localTime}, ${doctorName}`}
    data-testid="slot"
    data-start={slot.startsAt}
    data-doctor={slot.doctorId}
    className={`rounded-md border px-2 py-1 text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 ${selected ? 'border-sky-700 bg-sky-700 text-white' : 'border-slate-300 bg-white hover:border-sky-600 hover:bg-sky-50'}`}
  >
    {slot.localTime}
    {showDoctor && <span className="ml-1 text-xs opacity-70">{doctorName.split(' ').slice(-1)[0]}</span>}
  </button>
);
