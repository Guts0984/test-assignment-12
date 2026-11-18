'use client';

import { useTranslations } from 'next-intl';
import { PageTitle, SelectField } from '@/shared/ui';
import { useUrlState } from '@/shared/lib';
import { useClinicDoctors } from '@/entities/catalog';
import { useMe } from '@/entities/session';
import { ScheduleEditor } from '@/widgets/schedule-editor';

const KEYS = ['doctor'] as const;

export const RegistrarSchedulePage = () => {
  const t = useTranslations('registrar');
  const { me } = useMe();
  const [q, setQ] = useUrlState(KEYS);
  const { doctors } = useClinicDoctors(me?.clinicId ?? '');
  if (!me?.clinicId) return null;
  return (
    <>
      <PageTitle>{t('schedule')}</PageTitle>
      <SelectField
        className="mb-6 max-w-sm"
        label={t('chooseDoctor')}
        value={q.doctor}
        onChange={(e) => setQ({ doctor: e.target.value })}
        data-testid="schedule-doctor"
      >
        <option value="">{t('chooseDoctor')}</option>
        {doctors.map((d) => (
          <option key={d.id} value={d.id}>
            {d.fullName}
          </option>
        ))}
      </SelectField>
      <ScheduleEditor doctorId={q.doctor} clinicId={me.clinicId} />
    </>
  );
};
