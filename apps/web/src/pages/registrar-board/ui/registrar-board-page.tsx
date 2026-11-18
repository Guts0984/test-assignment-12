'use client';

import { useTranslations } from 'next-intl';
import { localDateOf } from '@clinic/shared';
import { PageTitle, TextField } from '@/shared/ui';
import { useUrlState } from '@/shared/lib';
import { useMe } from '@/entities/session';
import { useClinics } from '@/entities/catalog';
import { DayBoard } from '@/widgets/day-board';

const KEYS = ['date'] as const;

export const RegistrarBoardPage = () => {
  const t = useTranslations('registrar');
  const { me } = useMe();
  const { clinics } = useClinics();
  const [q, setQ] = useUrlState(KEYS);
  const clinic = clinics.find((c) => c.id === me?.clinicId);
  if (!me?.clinicId || !clinic) return null;
  const date = q.date || localDateOf(new Date(), clinic.timeZone);
  return (
    <>
      <PageTitle>{t('boardTitle')} · {clinic.city}</PageTitle>
      <TextField className="mb-4 max-w-xs" label={t('date')} type="date" value={date} onChange={(e) => setQ({ date: e.target.value })} />
      <DayBoard clinicId={me.clinicId} date={date} />
    </>
  );
};
