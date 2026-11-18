'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { PageTitle, SelectField } from '@/shared/ui';
import { useUrlState } from '@/shared/lib';
import { useFormat } from '@/shared/lib';
import { localDateOf } from '@clinic/shared';
import { serviceName, useClinics, useClinicDoctors, useClinicServices } from '@/entities/catalog';
import { useMe } from '@/entities/session';
import { SlotGrid, type PickedSlot } from '@/widgets/slot-grid';
import { focusSlot } from '@/entities/slot';
import { HoldPanel } from '@/features/hold-slot';
import { JoinWaitlist } from '@/features/waitlist';

const KEYS = ['city', 'service', 'doctor'] as const;

/**
 * Patient flow: city → service → (optional) doctor → free times → reserve → confirm.
 * City, service and doctor live in the URL, so reload, Back and shared links restore the same search.
 */
export const SearchPage = () => {
  const t = useTranslations('search');
  const locale = useLocale();
  const f = useFormat();
  const [q, setQ] = useUrlState(KEYS);
  const [picked, setPicked] = useState<PickedSlot | null>(null);
  const { me } = useMe();
  const { clinics } = useClinics();
  const { services } = useClinicServices(q.city);
  const { doctors } = useClinicDoctors(q.city, q.service);
  const clinic = clinics.find((c) => c.id === q.city);
  const svc = services.find((s) => s.service.id === q.service);

  return (
    <>
      <PageTitle>{t('title')}</PageTitle>
      <form
        className="mb-6 grid gap-3 sm:grid-cols-3"
        onSubmit={(e) => e.preventDefault()}
        aria-label={t('title')}
      >
        <SelectField
          label={t('city')}
          value={q.city}
          onChange={(e) => {
            setQ({ city: e.target.value, service: '', doctor: '' });
            setPicked(null);
          }}
          data-testid="city"
        >
          <option value="">{t('chooseCity')}</option>
          {clinics.map((c) => (
            <option key={c.id} value={c.id}>
              {c.city}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t('service')}
          value={q.service}
          disabled={!q.city}
          onChange={(e) => {
            setQ({ service: e.target.value, doctor: '' });
            setPicked(null);
          }}
          data-testid="service"
        >
          <option value="">{t('chooseService')}</option>
          {services.map((s) => (
            <option key={s.service.id} value={s.service.id}>
              {serviceName(s.service, locale)} — {f.money(s.priceMinor, s.currency)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t('doctor')}
          value={q.doctor}
          disabled={!q.service}
          onChange={(e) => {
            setQ({ doctor: e.target.value });
            setPicked(null);
          }}
          data-testid="doctor"
        >
          <option value="">{t('anyDoctor')}</option>
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>
              {d.fullName}
            </option>
          ))}
        </SelectField>
      </form>
      {svc && (
        <p className="mb-4 text-sm text-slate-700">
          {t('duration', { minutes: svc.service.durationMin })} ·{' '}
          {t('price', { price: f.money(svc.priceMinor, svc.currency) })}
        </p>
      )}
      {/* DOM order = reading order: the reservation comes BEFORE the grid, so Confirm is a few Tab stops away; on wide screens CSS puts it back on the right */}
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem] lg:grid-rows-[auto_1fr]">
        {picked && svc && clinic && (
          <div className="lg:col-start-2 lg:row-start-1">
            <HoldPanel
              signedIn={!!me && me.role === 'patient'}
              staff={!!me && me.role !== 'patient'}
              target={{
                clinicId: q.city,
                doctorId: picked.slot.doctorId,
                serviceId: q.service,
                startsAt: picked.slot.startsAt,
                doctorName: picked.doctorName,
                serviceName: serviceName(svc.service, locale),
                timeZone: picked.timeZone,
                priceLabel: f.money(picked.priceMinor, picked.currency),
              }}
              onClose={() => {
                focusSlot(picked.slot);
                setPicked(null);
              }}
              onChanged={() => undefined}
            />
          </div>
        )}
        <div className="lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <SlotGrid
            clinicId={q.city}
            clinicLabel={clinic?.city ?? ''}
            serviceId={q.service}
            doctorId={q.doctor}
            selected={picked?.slot}
            onPick={setPicked}
          />
        </div>
        {q.service && (
          <div className="lg:col-start-2 lg:row-start-2">
            <JoinWaitlist
              doctorId={q.doctor}
              doctors={doctors}
              serviceId={q.service}
              defaultFrom={clinic ? localDateOf(new Date(), clinic.timeZone) : ''}
              signedIn={!!me && me.role === 'patient'}
            />
          </div>
        )}
      </div>
    </>
  );
};
