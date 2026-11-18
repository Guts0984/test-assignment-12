'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation } from 'urql';
import { useTranslations } from 'next-intl';
import { scheduleExceptionSchema } from '@clinic/shared';
import { graphql } from '@/shared/api';
import { errorCode } from '@/shared/api';
import { Button, ErrorNote, SelectField, TextField } from '@/shared/ui';

const SetExceptionDocument = graphql(`mutation SetScheduleException($input: ExceptionInput!) { setScheduleException(input: $input) }`);

type V = { localDate: string; kind: string; startLocal: string; endLocal: string };

export const ExceptionForm = ({ doctorId, clinicId, onDone }: { doctorId: string; clinicId: string; onDone: () => void }) => {
  const t = useTranslations('registrar');
  const v = useTranslations('validation');
  const c = useTranslations('common');
  const [, save] = useMutation(SetExceptionDocument);
  const [code, setCode] = useState<string | null>(null);
  const { register, handleSubmit, watch, setError, formState: { errors, isSubmitting } } = useForm<V>({ defaultValues: { kind: 'vacation', startLocal: '10:00', endLocal: '14:00', localDate: '' } });
  const needsHours = ['extra_day', 'custom_hours'].includes(watch('kind'));
  return (
    <form noValidate className="grid grid-cols-2 items-end gap-3 sm:grid-cols-5" onSubmit={handleSubmit(async (values) => {
      setCode(null);
      const candidate = { doctorId, localDate: values.localDate, kind: values.kind, ...(needsHours ? { clinicId, startLocal: values.startLocal, endLocal: values.endLocal } : {}) };
      const parsed = scheduleExceptionSchema.safeParse(candidate);
      if (!parsed.success) { for (const i of parsed.error.issues) { const f = String(i.path[0] ?? ''); if (f in values) setError(f as keyof V, { type: 'zod' }); } return; }
      const r = await save({ input: parsed.data as never });
      if (r.error) setCode(errorCode(r.error)); else onDone();
    })}>
      <TextField label={t('date')} type="date" {...register('localDate')} error={errors.localDate ? v('date') : undefined} />
      <SelectField label={t('kind')} {...register('kind')}>
        <option value="vacation">{t('vacation')}</option><option value="day_off">{t('day_off')}</option>
        <option value="extra_day">{t('extra_day')}</option><option value="custom_hours">{t('custom_hours')}</option>
      </SelectField>
      {needsHours && <><TextField label={t('start')} type="time" step={900} {...register('startLocal')} error={errors.startLocal ? v('time') : undefined} /><TextField label={t('end')} type="time" step={900} {...register('endLocal')} error={errors.endLocal ? v('time') : undefined} /></>}
      <Button type="submit" disabled={isSubmitting} data-testid="save-exception">{c('save')}</Button>
      <div className="col-span-full"><ErrorNote code={code} /></div>
    </form>
  );
};
