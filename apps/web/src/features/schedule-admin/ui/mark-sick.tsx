'use client';

import { useState } from 'react';
import { useMutation } from 'urql';
import { useTranslations } from 'next-intl';
import { graphql } from '@/shared/api';
import { errorCode } from '@/shared/api';
import { Button, ErrorNote } from '@/shared/ui';

const SickDocument = graphql(`
  mutation MarkDoctorSick($input: MarkSickInput!) {
    markDoctorSick(input: $input) {
      cancelled
      alreadyMarked
    }
  }
`);

/** One click cancels the doctor's whole day and emails the patients; repeating it changes nothing. */
export const MarkSick = ({
  doctorId,
  localDate,
  onDone,
}: {
  doctorId: string;
  localDate: string;
  onDone: () => void;
}) => {
  const t = useTranslations('registrar');
  const [, mark] = useMutation(SickDocument);
  const [asking, setAsking] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [result, setResult] = useState<number | null>(null);
  if (!asking)
    return (
      <Button variant="danger" data-testid="sick-open" onClick={() => setAsking(true)}>
        {t('sick')}
      </Button>
    );
  return (
    <div role="group" aria-label={t('sick')} className="rounded-md bg-rose-50 p-3">
      <p className="mb-2 text-sm">{t('sickAsk')}</p>
      <ErrorNote code={code} />
      {result !== null && (
        <p role="status" className="text-sm font-medium" data-testid="sick-result">
          {t('sickDone', { count: result })}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <Button
          variant="danger"
          data-testid="sick-confirm"
          onClick={async () => {
            const r = await mark({ input: { doctorId, localDate } });
            if (r.error) setCode(errorCode(r.error));
            else {
              setResult(r.data?.markDoctorSick.cancelled ?? 0);
              onDone();
            }
          }}
        >
          {t('sick')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setAsking(false);
            setResult(null);
          }}
        >
          ×
        </Button>
      </div>
    </div>
  );
};
