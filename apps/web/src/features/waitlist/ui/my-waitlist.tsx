'use client';

import { useMutation, useQuery } from 'urql';
import { useLocale, useTranslations } from 'next-intl';
import { graphql } from '@/shared/api';
import { Button } from '@/shared/ui';
import { formatLocalDate } from '@/shared/lib';

const MyWaitlistDocument = graphql(`query MyWaitlist { myWaitlist { id fromDate toDate priority doctor { fullName } service { nameUk nameEn namePl } } }`);
const LeaveDocument = graphql(`mutation LeaveWaitlist($id: ID!) { leaveWaitlist(id: $id) }`);

export const MyWaitlist = () => {
  const t = useTranslations('cabinet');
  const locale = useLocale();
  const [{ data }, refetch] = useQuery({ query: MyWaitlistDocument, requestPolicy: 'cache-and-network' });
  const [, leave] = useMutation(LeaveDocument);
  const items = data?.myWaitlist ?? [];
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="wl-list" className="mb-6">
      <h2 id="wl-list" className="mb-2 text-lg font-semibold">{t('waitlist')}</h2>
      <ul className="flex flex-col gap-2">
        {items.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white p-3 text-sm" data-testid="waitlist-entry">
            <span>{e.doctor.fullName} · {locale === 'en' ? e.service.nameEn : locale === 'pl' ? e.service.namePl : e.service.nameUk} · {formatLocalDate(e.fromDate, locale)} – {formatLocalDate(e.toDate, locale)}</span>
            <Button variant="ghost" onClick={async () => { await leave({ id: e.id }); refetch({ requestPolicy: 'network-only' }); }}>{t('leave')}</Button>
          </li>
        ))}
      </ul>
    </section>
  );
};
