'use client';

import { useEffect, useRef, useState } from 'react';
import { useMemo } from 'react';
import { useMutation, useQuery } from 'urql';
import { useTranslations } from 'next-intl';
import { phoneSchema } from '@clinic/shared';
import { graphql } from '@/shared/api';
import { errorCode } from '@/shared/api';
import { Button, Card, ErrorNote, TextField } from '@/shared/ui';
import { newKey } from '@/shared/lib';

const SearchDocument = graphql(`query SearchPatients($query: String!) { searchPatients(query: $query) { id fullName phone onlineBookingBlockedUntil } }`);
const BookDocument = graphql(`mutation RegistrarBook($input: RegistrarBookInput!) { registrarBook(input: $input) { id status startsAt } }`);

export type PhoneSlot = { clinicId: string; doctorId: string; serviceId: string; startsAt: string };

/** Phone booking: the same rules and the same server path as the website; the registrar names the patient. */
export const PhoneBookingForm = ({ slot, onBooked }: { slot: PhoneSlot; onBooked: () => void }) => {
  const t = useTranslations('registrar');
  const a = useTranslations('auth');
  const v = useTranslations('validation');
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<{ id: string; fullName: string } | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [fieldErr, setFieldErr] = useState<{ name?: boolean; phone?: boolean }>({});
  const [code, setCode] = useState<string | null>(null);
  // one idempotency key per booking intent (this slot + this patient): a retry reuses it, another time gets a new one
  const key = useMemo(() => newKey(), [slot.doctorId, slot.startsAt, slot.serviceId, chosen?.id]);
  const [done, setDone] = useState(false);
  const [{ data }] = useQuery({ query: SearchDocument, variables: { query: q }, pause: q.trim().length < 2 });
  const [, book] = useMutation(BookDocument);
  const heading = useRef<HTMLHeadingElement>(null);
  // keyboard: the form appears next to the grid, so focus moves to it (its first field is one Tab away)
  useEffect(() => { heading.current?.focus(); }, [slot.doctorId, slot.startsAt]);

  const submit = async (): Promise<void> => {
    setCode(null);
    const patient = chosen ? { patientId: chosen.id } : { newPatientName: name, newPatientPhone: phone };
    if (!chosen) {
      const bad = { name: name.trim().length < 2, phone: !phoneSchema.safeParse(phone).success };
      setFieldErr(bad);
      if (bad.name || bad.phone) return;
    }
    const r = await book({ input: { ...slot, ...patient, idempotencyKey: key } as never });
    if (r.error) setCode(errorCode(r.error)); else { setDone(true); onBooked(); }
  };

  return (
    <Card aria-labelledby="pb-title" data-testid="phone-booking">
      <h2 id="pb-title" ref={heading} tabIndex={-1} className="mb-3 text-lg font-semibold focus:outline-none focus-visible:outline-2 focus-visible:outline-sky-700">{t('phoneBooking')}</h2>
      <TextField label={t('searchPatient')} value={q} onChange={(e) => { setQ(e.target.value); setChosen(null); }} />
      {(data?.searchPatients ?? []).length > 0 && (
        <ul className="my-2 flex flex-col gap-1" aria-label={t('searchPatient')}>
          {data?.searchPatients.map((p) => (
            <li key={p.id}><Button variant={chosen?.id === p.id ? 'primary' : 'secondary'} className="w-full justify-start" onClick={() => setChosen({ id: p.id, fullName: p.fullName })}>{p.fullName} · {p.phone}</Button></li>
          ))}
        </ul>
      )}
      {!chosen && (
        <fieldset className="mt-3 grid gap-3 sm:grid-cols-2">
          <legend className="text-sm font-medium">{t('newPatient')}</legend>
          <TextField label={a('fullName')} value={name} onChange={(e) => setName(e.target.value)} error={fieldErr.name ? v('fullName') : undefined} />
          <TextField label={a('phone')} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+380501234567" error={fieldErr.phone ? v('phone') : undefined} />
        </fieldset>
      )}
      <div className="mt-3"><ErrorNote code={code} /></div>
      <div className="mt-3 flex items-center gap-3">
        <Button onClick={submit} disabled={done} data-testid="phone-book">{chosen ? t('bookFor', { name: chosen.fullName }) : t('phoneBooking')}</Button>
        {done && <p role="status" className="text-sm font-medium text-emerald-800" data-testid="phone-booked">✓</p>}
      </div>
    </Card>
  );
};
