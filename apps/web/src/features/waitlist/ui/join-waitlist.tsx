'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation } from 'urql';
import { useTranslations } from 'next-intl';
import { addDays, daysBetween } from '@clinic/shared';
import { graphql } from '@/shared/api';
import { errorCode } from '@/shared/api';
import { Button, Card, ErrorNote, TextField } from '@/shared/ui';

const JoinDocument = graphql(`mutation JoinWaitlist($input: JoinWaitlistInput!) { joinWaitlist(input: $input) { id fromDate toDate } }`);

type Values = { fromDate: string; toDate: string };

/** "No convenient time": queue for a doctor and a range of dates; the server offers freed times in order. */
export const JoinWaitlist = ({ doctorId, serviceId, defaultFrom, signedIn }: { doctorId: string; serviceId: string; defaultFrom: string; signedIn: boolean }) => {
  const t = useTranslations('search');
  const v = useTranslations('validation');
  const [, join] = useMutation(JoinDocument);
  const [code, setCode] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Values>({ defaultValues: { fromDate: defaultFrom, toDate: defaultFrom ? addDays(defaultFrom, 13) : '' } });
  // the clinic (and so today in its time zone) arrives after the first render; default range = the next 14 days
  useEffect(() => { if (defaultFrom) reset({ fromDate: defaultFrom, toDate: addDays(defaultFrom, 13) }); }, [defaultFrom, reset]);
  if (!signedIn || !doctorId) return null;
  return (
    <Card aria-labelledby="wl-title">
      <h2 id="wl-title" className="text-lg font-semibold">{t('waitlistTitle')}</h2>
      <p className="mb-3 text-sm text-slate-700">{t('waitlistText')}</p>
      <form noValidate className="flex flex-wrap items-end gap-3" onSubmit={handleSubmit(async (values) => {
        setCode(null);
        const r = await join({ input: { doctorId, serviceId, ...values } });
        if (r.error) setCode(errorCode(r.error)); else setDone(true);
      })}>
        <TextField label={t('waitlistFrom')} type="date" {...register('fromDate', { required: true })} error={errors.fromDate ? v('date') : undefined} />
        <TextField label={t('waitlistTo')} type="date" {...register('toDate', { required: true, validate: (x, f) => daysBetween(f.fromDate, x) >= 0 || v('range') })} error={errors.toDate ? v('range') : undefined} />
        <Button type="submit" disabled={isSubmitting} data-testid="join-waitlist">{t('waitlistJoin')}</Button>
      </form>
      <div className="mt-2"><ErrorNote code={code} /></div>
      {done && <p role="status" className="mt-2 text-sm font-medium text-emerald-800" data-testid="waitlist-joined">{t('waitlistJoined')}</p>}
    </Card>
  );
};
