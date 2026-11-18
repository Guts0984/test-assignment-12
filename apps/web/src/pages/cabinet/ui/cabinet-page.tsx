'use client';

import { useQuery } from 'urql';
import { useTranslations } from 'next-intl';
import { graphql } from '@/shared/api';
import { PageTitle } from '@/shared/ui';
import { useUrlState } from '@/shared/lib';
import { AppointmentList } from '@/widgets/appointment-list';
import { MyWaitlist, OffersPanel } from '@/features/waitlist';
import { useMe } from '@/entities/session';

const NotificationsDocument = graphql(`query MyNotifications { myNotifications(limit: 10) { id kind createdAt readAt } }`);
const TABS = ['tab'] as const;

export const CabinetPage = () => {
  const t = useTranslations('cabinet');
  const [q, setQ] = useUrlState(TABS);
  const tab = q.tab === 'past' ? 'PAST' : 'UPCOMING';
  const { me, fetching } = useMe();
  const [{ data }] = useQuery({ query: NotificationsDocument, pause: !me });
  if (!me && !fetching) return <p>{t('none')}</p>;
  return (
    <>
      <PageTitle>{t('title')}</PageTitle>
      <OffersPanel onChanged={() => undefined} />
      <MyWaitlist />
      <div role="tablist" aria-label={t('title')} className="mb-4 flex gap-2">
        {(['UPCOMING', 'PAST'] as const).map((k) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setQ({ tab: k === 'PAST' ? 'past' : '' })}
            className={`rounded-md px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-sky-700 ${tab === k ? 'bg-sky-700 text-white' : 'bg-white ring-1 ring-slate-300'}`}>{k === 'PAST' ? t('past') : t('upcoming')}</button>
        ))}
      </div>
      <div role="tabpanel"><AppointmentList scope={tab} /></div>
      {(data?.myNotifications ?? []).length > 0 && (
        <section aria-labelledby="nt" className="mt-8"><h2 id="nt" className="mb-2 text-lg font-semibold">{t('notifications')}</h2>
          <ul className="text-sm text-slate-700">{data?.myNotifications.map((n) => <li key={n.id}>{n.kind} · {new Date(n.createdAt).toLocaleString()}</li>)}</ul></section>
      )}
    </>
  );
};
