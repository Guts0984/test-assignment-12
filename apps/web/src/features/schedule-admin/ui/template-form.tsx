'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation } from 'urql';
import { useTranslations } from 'next-intl';
import { scheduleTemplateSchema } from '@clinic/shared';
import { graphql } from '@/shared/api';
import { errorCode } from '@/shared/api';
import { Button, ErrorNote, SelectField, TextField } from '@/shared/ui';

const SetScheduleTemplateDocument = graphql(`mutation SetScheduleTemplate($input: TemplateInput!) { setScheduleTemplate(input: $input) }`);

type V = { weekday: string; startLocal: string; endLocal: string; breakStartLocal: string; breakEndLocal: string };

export const TemplateForm = ({ doctorId, clinicId, onDone }: { doctorId: string; clinicId: string; onDone: () => void }) => {
  const t = useTranslations('registrar');
  const w = useTranslations('weekdays');
  const v = useTranslations('validation');
  const [, save] = useMutation(SetScheduleTemplateDocument);
  const [code, setCode] = useState<string | null>(null);
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<V>({ defaultValues: { weekday: '1', startLocal: '09:00', endLocal: '17:00', breakStartLocal: '13:00', breakEndLocal: '14:00' } });
  return (
    <form noValidate className="grid grid-cols-2 items-end gap-3 sm:grid-cols-6" onSubmit={handleSubmit(async (values) => {
      setCode(null);
      const parsed = scheduleTemplateSchema.safeParse({ doctorId, clinicId, weekday: Number(values.weekday), startLocal: values.startLocal, endLocal: values.endLocal, breakStartLocal: values.breakStartLocal || null, breakEndLocal: values.breakEndLocal || null });
      if (!parsed.success) {
        for (const i of parsed.error.issues) { const f = String(i.path[0] ?? ''); if (f in values) setError(f as keyof V, { type: 'zod' }); }
        return;
      }
      const r = await save({ input: parsed.data });
      if (r.error) setCode(errorCode(r.error)); else onDone();
    })}>
      <SelectField label={t('weekday')} {...register('weekday')}>{[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{w(String(d) as '1')}</option>)}</SelectField>
      <TextField label={t('start')} type="time" step={900} {...register('startLocal')} error={errors.startLocal ? v('time') : undefined} />
      <TextField label={t('end')} type="time" step={900} {...register('endLocal')} error={errors.endLocal ? v('time') : undefined} />
      <TextField label={t('breakStart')} type="time" step={900} {...register('breakStartLocal')} error={errors.breakStartLocal ? v('time') : undefined} />
      <TextField label={t('breakEnd')} type="time" step={900} {...register('breakEndLocal')} error={errors.breakEndLocal ? v('time') : undefined} />
      <Button type="submit" disabled={isSubmitting} data-testid="save-template">{useSave()}</Button>
      <div className="col-span-full"><ErrorNote code={code} /></div>
    </form>
  );
};
const useSave = (): string => useTranslations('common')('save');
