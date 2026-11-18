'use client';

import { useTranslations } from 'next-intl';
import { addDays, localDateOf } from '@clinic/shared';
import { PageTitle, SelectField, TextField } from '@/shared/ui';
import { useUrlState } from '@/shared/lib';
import { useClinics } from '@/entities/catalog';
import { ReportPanel } from '@/widgets/report-panel';

const KEYS = ['from', 'to', 'clinic'] as const;

/** The period lives in the URL (?from=&to=&clinic=): reload, Back and a pasted link show the same report. */
export const ManagerReportPage = () => {
  const t = useTranslations('report');
  const { clinics } = useClinics();
  const [q, setQ] = useUrlState(KEYS);
  const today = localDateOf(new Date(), 'Europe/Kyiv');
  const to = q.to || today;
  const from = q.from || addDays(to, -89);
  return (
    <>
      <PageTitle>{t('title')}</PageTitle>
      <form className="mb-6 grid gap-3 sm:grid-cols-3" onSubmit={(e) => e.preventDefault()}>
        <TextField label={t('from')} type="date" value={from} onChange={(e) => setQ({ from: e.target.value, to })} />
        <TextField label={t('to')} type="date" value={to} onChange={(e) => setQ({ to: e.target.value, from })} />
        <SelectField label={t('clinic')} value={q.clinic} onChange={(e) => setQ({ clinic: e.target.value, from, to })}>
          <option value="">{t('allClinics')}</option>
          {clinics.map((c) => <option key={c.id} value={c.id}>{c.city}</option>)}
        </SelectField>
      </form>
      <ReportPanel from={from} to={to} clinicId={q.clinic} />
    </>
  );
};
