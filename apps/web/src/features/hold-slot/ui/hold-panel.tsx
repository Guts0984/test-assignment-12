'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation } from 'urql';
import { useTranslations } from 'next-intl';
import { graphql } from '@/shared/api';
import { errorCode } from '@/shared/api';
import { Button, Card, ErrorNote, Spinner } from '@/shared/ui';
import { Link } from '@/shared/i18n';
import { mmss, useCountdown } from '@/shared/lib';
import { newKey } from '@/shared/lib';
import { useFormat } from '@/shared/lib';

const HoldDocument = graphql(`mutation HoldSlot($input: HoldSlotInput!) { holdSlot(input: $input) { id holdExpiresAt } }`);
const ConfirmDocument = graphql(`mutation ConfirmBooking($input: ConfirmBookingInput!) { confirmBooking(input: $input) { id status } }`);
const ReleaseDocument = graphql(`mutation ReleaseHold($input: CancelInput!) { cancelAppointment(input: $input) { id status } }`);

export type HoldTarget = { clinicId: string; doctorId: string; serviceId: string; startsAt: string; doctorName: string; serviceName: string; timeZone: string; priceLabel: string };

/**
 * Step 2 of booking: the chosen time is reserved for the patient while they confirm. The server holds
 * it for 10 minutes; the countdown shows the same deadline. Confirm sends one idempotency key per hold,
 * so a double click or a network retry cannot book twice.
 */
export const HoldPanel = ({ target, signedIn, staff = false, onClose, onChanged }: { target: HoldTarget; signedIn: boolean; /** signed in, but as registrar / doctor / manager */ staff?: boolean; onClose: () => void; onChanged: () => void }) => {
  const t = useTranslations('hold');
  const authT = useTranslations('auth');
  const commonT = useTranslations('common');
  const f = useFormat();
  const [, hold] = useMutation(HoldDocument);
  const [, confirm] = useMutation(ConfirmDocument);
  const [, release] = useMutation(ReleaseDocument);
  const [state, setState] = useState<'holding' | 'held' | 'confirming' | 'done' | 'expired' | 'failed'>('holding');
  const [code, setCode] = useState<string | null>(null);
  const [appt, setAppt] = useState<{ id: string; until: Date } | null>(null);
  const key = useRef(newKey());
  const started = useRef<string>('');
  const left = useCountdown(appt && state === 'held' ? appt.until : null);

  useEffect(() => {
    if (!signedIn) return;
    const id = `${target.doctorId}|${target.startsAt}`;
    if (started.current === id) return;
    started.current = id;
    key.current = newKey();
    setState('holding');
    setCode(null);
    void hold({ input: { clinicId: target.clinicId, doctorId: target.doctorId, serviceId: target.serviceId, startsAt: target.startsAt } }).then((r) => {
      if (r.error || !r.data) {
        setCode(errorCode(r.error));
        setState('failed');
        onChanged();
        return;
      }
      setAppt({ id: r.data.holdSlot.id, until: new Date(r.data.holdSlot.holdExpiresAt as string) });
      setState('held');
    });
  }, [target.doctorId, target.startsAt, signedIn]);

  // the hold ends when the server's deadline passes (the server is the authority; this only updates the screen)
  useEffect(() => {
    if (state !== 'held' || !appt) return;
    const id = setTimeout(() => { setState('expired'); onChanged(); }, Math.max(0, appt.until.getTime() - Date.now()));
    return () => clearTimeout(id);
  }, [state, appt]);

  if (staff) {
    return (
      <Card aria-live="polite" data-testid="staff-note">
        <p className="mb-2 text-sm">{t('patientsOnly')}</p>
        <Button variant="ghost" onClick={onClose}>{commonT('close')}</Button>
      </Card>
    );
  }

  if (!signedIn) {
    return (
      <Card aria-live="polite">
        <p className="mb-2 text-sm">{authT('needSignIn')}</p>
        <div className="flex gap-2">
          <Link className="text-sky-800 underline" href={`/sign-in`}>{commonT('signIn')}</Link>
          <Button variant="ghost" onClick={onClose}>{commonT('close')}</Button>
        </div>
      </Card>
    );
  }

  const doConfirm = async (): Promise<void> => {
    if (!appt) return;
    setState('confirming');
    setCode(null);
    const r = await confirm({ input: { appointmentId: appt.id, idempotencyKey: key.current } });
    if (r.error) {
      setCode(errorCode(r.error));
      setState(errorCode(r.error) === 'HOLD_EXPIRED' ? 'expired' : 'held');
      onChanged();
      return;
    }
    setState('done');
    onChanged();
  };
  const doRelease = async (): Promise<void> => {
    if (appt && state === 'held') await release({ input: { appointmentId: appt.id } });
    onChanged();
    onClose();
  };

  return (
    <Card aria-live="polite" data-testid="hold-panel" data-state={state}>
      <h2 className="text-lg font-semibold">{t('title')}</h2>
      <p className="text-sm text-slate-700">
        {t('summary', { service: target.serviceName, doctor: target.doctorName, when: f.dateTime(target.startsAt, target.timeZone), price: target.priceLabel })}
      </p>
      {state === 'holding' && <p className="mt-2"><Spinner /></p>}
      {state === 'held' && (
        <>
          <p className="mt-2 text-sm font-medium tabular-nums" data-testid="countdown">{t('expiresIn', { time: mmss(left) })}</p>
          <div className="mt-3 flex gap-2">
            <Button onClick={doConfirm} data-testid="confirm-booking">{t('confirm')}</Button>
            <Button variant="secondary" onClick={doRelease}>{t('release')}</Button>
          </div>
        </>
      )}
      {state === 'confirming' && <p className="mt-2"><Spinner /></p>}
      {state === 'done' && (
        <>
          <p className="mt-2 text-sm font-medium text-emerald-800" role="status" data-testid="booked-note">{t('confirmed')}</p>
          <div className="mt-3"><Button variant="secondary" onClick={onClose}>{commonT('close')}</Button></div>
        </>
      )}
      {state === 'expired' && (
        <>
          <p className="mt-2 text-sm text-amber-900" role="status" data-testid="expired-note">{t('expired')}</p>
          <div className="mt-3"><Button variant="secondary" onClick={onClose}>{commonT('close')}</Button></div>
        </>
      )}
      <div className="mt-2"><ErrorNote code={code} /></div>
      {state === 'failed' && <div className="mt-3"><Button variant="secondary" onClick={onClose}>{commonT('close')}</Button></div>}
    </Card>
  );
};
