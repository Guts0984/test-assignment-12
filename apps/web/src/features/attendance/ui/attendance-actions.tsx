'use client';

import { useState } from 'react';
import { useMutation } from 'urql';
import { useTranslations } from 'next-intl';
import { graphql } from '@/shared/api';
import { errorCode } from '@/shared/api';
import { Button, ErrorNote } from '@/shared/ui';

const CheckInDocument = graphql(`mutation CheckIn($id: ID!) { checkIn(id: $id) { id status boardState } }`);
const NoShowDocument = graphql(`mutation MarkNoShow($id: ID!) { markNoShow(id: $id) { id status boardState } }`);
const CompleteDocument = graphql(`mutation CompleteVisit($id: ID!) { completeVisit(id: $id) { id status boardState } }`);

/** Registrar: arrived / no-show. Doctor: complete / no-show. Only the actions that fit the visit's status. */
export const AttendanceActions = ({ id, status, role, onDone }: { id: string; status: string; role: 'registrar' | 'doctor'; onDone: () => void }) => {
  const r = useTranslations('registrar');
  const d = useTranslations('doctor');
  const [, checkIn] = useMutation(CheckInDocument);
  const [, noShow] = useMutation(NoShowDocument);
  const [, complete] = useMutation(CompleteDocument);
  const [code, setCode] = useState<string | null>(null);
  const run = async (fn: () => Promise<{ error?: Parameters<typeof errorCode>[0] }>): Promise<void> => {
    setCode(null);
    const res = await fn();
    if (res.error) setCode(errorCode(res.error)); else onDone();
  };
  if (status !== 'booked' && status !== 'checked_in') return null;
  return (
    <>
      {role === 'registrar' && status === 'booked' && <Button data-testid="check-in" onClick={() => run(() => checkIn({ id }))}>{r('checkIn')}</Button>}
      {role === 'doctor' && <Button data-testid="complete" onClick={() => run(() => complete({ id }))}>{d('complete')}</Button>}
      {status === 'booked' && <Button variant="secondary" data-testid="no-show" onClick={() => run(() => noShow({ id }))}>{role === 'doctor' ? d('noShow') : r('noShow')}</Button>}
      <ErrorNote code={code} />
    </>
  );
};
