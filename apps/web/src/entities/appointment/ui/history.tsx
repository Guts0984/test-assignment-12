'use client';

import { useState } from 'react';
import { useQuery } from 'urql';
import { useTranslations } from 'next-intl';
import { graphql } from '@/shared/api';
import { useFormat } from '@/shared/lib';

const HistoryDocument = graphql(`
  query AppointmentHistory($id: ID!) {
    appointment(id: $id) {
      id
      events {
        type
        at
        actorRole
        late
        reason
        fromStatus
        toStatus
        oldStartsAt
        newStartsAt
      }
    }
  }
`);

const Events = ({ id, tz }: { id: string; tz: string }) => {
  const f = useFormat();
  const [{ data, fetching }] = useQuery({ query: HistoryDocument, variables: { id } });
  if (fetching && !data) return <p className="text-xs text-slate-600">…</p>;
  return (
    <ol className="mt-2 flex flex-col gap-1 text-xs text-slate-700" data-testid="history">
      {data?.appointment?.events.map((e, i) => (
        <li key={i}>
          {f.dateTime(e.at, tz)} · {e.type} · {e.actorRole}
          {e.late ? ' · late' : ''}
          {e.reason ? ` · ${e.reason}` : ''}
          {e.type === 'rescheduled' && e.oldStartsAt && e.newStartsAt
            ? ` (${f.dateTime(e.oldStartsAt, tz)} → ${f.dateTime(e.newStartsAt, tz)})`
            : ''}
        </li>
      ))}
    </ol>
  );
};

/** Who did what and when, loaded only when opened (the list itself stays cheap). */
export const AppointmentHistory = ({ id, tz }: { id: string; tz: string }) => {
  const t = useTranslations('cabinet');
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} className="mt-2">
      <summary className="cursor-pointer text-sm text-sky-900">{t('history')}</summary>
      {open && <Events id={id} tz={tz} />}
    </details>
  );
};
