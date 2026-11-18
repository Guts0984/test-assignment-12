'use client';

import { useState } from 'react';
import { useMutation } from 'urql';
import { useTranslations } from 'next-intl';
import { graphql } from '@/shared/api';
import { errorCode } from '@/shared/api';
import { Button, ErrorNote } from '@/shared/ui';

const RemoveTemplateDocument = graphql(`mutation RemoveScheduleTemplate($input: RemoveTemplateInput!) { removeScheduleTemplate(input: $input) }`);
const RemoveExceptionDocument = graphql(`mutation RemoveScheduleException($input: RemoveExceptionInput!) { removeScheduleException(input: $input) }`);

export const RemoveButton = ({ what, onDone }: { what: { type: 'template'; doctorId: string; clinicId: string; weekday: number } | { type: 'exception'; doctorId: string; localDate: string }; onDone: () => void }) => {
  const t = useTranslations('registrar');
  const [, rmT] = useMutation(RemoveTemplateDocument);
  const [, rmE] = useMutation(RemoveExceptionDocument);
  const [code, setCode] = useState<string | null>(null);
  return (
    <>
      <Button variant="ghost" onClick={async () => {
        const r = what.type === 'template' ? await rmT({ input: { doctorId: what.doctorId, clinicId: what.clinicId, weekday: what.weekday } }) : await rmE({ input: { doctorId: what.doctorId, localDate: what.localDate } });
        if (r.error) setCode(errorCode(r.error)); else onDone();
      }}>{t('remove')}</Button>
      <ErrorNote code={code} />
    </>
  );
};
