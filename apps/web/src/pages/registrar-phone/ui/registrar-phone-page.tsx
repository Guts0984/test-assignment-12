'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { PageTitle, SelectField } from '@/shared/ui';
import { useUrlState } from '@/shared/lib';
import { serviceName, useClinicDoctors, useClinicServices, useClinics } from '@/entities/catalog';
import { useMe } from '@/entities/session';
import { SlotGrid, type PickedSlot } from '@/widgets/slot-grid';
import { PhoneBookingForm } from '@/features/phone-booking';

const KEYS = ['service', 'doctor'] as const;

/** Registrar books by phone: the same grid and the same rules as the website, for any patient. */
export const RegistrarPhonePage = () => {
  const t = useTranslations('search');
  const r = useTranslations('registrar');
  const locale = useLocale();
  const { me } = useMe();
  const { clinics } = useClinics();
  const [q, setQ] = useUrlState(KEYS);
  const [picked, setPicked] = useState<PickedSlot | null>(null);
  const clinicId = me?.clinicId ?? '';
  const { services } = useClinicServices(clinicId);
  const { doctors } = useClinicDoctors(clinicId, q.service);
  const clinic = clinics.find((c) => c.id === clinicId);
  if (!clinicId) return null;
  return (
    <>
      <PageTitle>{r('phoneBooking')} · {clinic?.city}</PageTitle>
      <form className="mb-6 grid gap-3 sm:grid-cols-2" onSubmit={(e) => e.preventDefault()}>
        <SelectField label={t('service')} value={q.service} onChange={(e) => { setQ({ service: e.target.value, doctor: '' }); setPicked(null); }} data-testid="service">
          <option value="">{t('chooseService')}</option>
          {services.map((s) => <option key={s.service.id} value={s.service.id}>{serviceName(s.service, locale)}</option>)}
        </SelectField>
        <SelectField label={t('doctor')} value={q.doctor} disabled={!q.service} onChange={(e) => { setQ({ doctor: e.target.value }); setPicked(null); }}>
          <option value="">{t('anyDoctor')}</option>
          {doctors.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
        </SelectField>
      </form>
      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <SlotGrid clinicId={clinicId} clinicLabel={clinic?.city ?? ''} serviceId={q.service} doctorId={q.doctor} selected={picked?.slot} onPick={setPicked} />
        {picked && <PhoneBookingForm slot={{ clinicId, doctorId: picked.slot.doctorId, serviceId: q.service, startsAt: picked.slot.startsAt }} onBooked={() => undefined} />}
      </div>
    </>
  );
};
