'use client';

import { useState } from 'react';
import { useMutation } from 'urql';
import { useTranslations } from 'next-intl';
import { graphql } from '@/shared/api';
import { errorCode } from '@/shared/api';
import { Button, ErrorNote } from '@/shared/ui';

const CancelDocument = graphql(`mutation CancelAppointment($input: CancelInput!) { cancelAppointment(input: $input) { id status cancelledLate } }`);

/** Cancel with an explicit confirmation; warns when it would be a late cancellation (< 24 h). */
export const CancelAppointment = ({ id, startsAt, onDone }: { id: string; startsAt: string; onDone: () => void }) => {
  const t = useTranslations('cabinet');
  const c = useTranslations('common');
  const [, cancel] = useMutation(CancelDocument);
  const [asking, setAsking] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const late = new Date(startsAt).getTime() - Date.now() < 24 * 3_600_000;

  if (!asking) return <Button variant="secondary" onClick={() => setAsking(true)} data-testid="cancel-visit">{t('cancelVisit')}</Button>;
  return (
    <div role="group" aria-label={t('cancelAsk')} className="flex w-full flex-col gap-2 rounded-md bg-rose-50 p-3">
      <p className="text-sm font-medium">{t('cancelAsk')}</p>
      {late && <p className="text-sm text-rose-900" data-testid="late-warning">{t('lateWarning')}</p>}
      <ErrorNote code={code} />
      <div className="flex gap-2">
        <Button variant="danger" data-testid="cancel-yes" onClick={async () => {
          const r = await cancel({ input: { appointmentId: id } });
          if (r.error) setCode(errorCode(r.error));
          else { setAsking(false); onDone(); }
        }}>{c('yes')}</Button>
        <Button variant="secondary" onClick={() => setAsking(false)}>{c('no')}</Button>
      </div>
    </div>
  );
};
