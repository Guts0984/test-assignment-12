'use client';

import { useQuery } from 'urql';
import { useTranslations } from 'next-intl';
import { graphql } from '@/shared/api';
import { Card, ErrorNote, Spinner } from '@/shared/ui';
import { errorCode } from '@/shared/api';
import { useFormat } from '@/shared/lib';
import { useClinics } from '@/entities/catalog';

const ReportDocument = graphql(`
  query Report($from: String!, $to: String!, $clinicId: ID) {
    report(from: $from, to: $to, clinicId: $clinicId) {
      from
      to
      utilization {
        doctorId
        doctorName
        clinicId
        workMinutes
        bookedMinutes
        percent
      }
      rates {
        bookings
        noShows
        lateCancels
        noShowPercent
        lateCancelPercent
      }
      waitlist {
        offered
        accepted
        acceptedPercent
      }
      revenue {
        serviceId
        serviceCode
        nameUk
        nameEn
        namePl
        currency
        revenueMinor
        visits
      }
    }
  }
`);

const pctFmt = (n: number, locale: string): string =>
  `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n)}%`;

/** Network report for a period from the URL: utilization, no-shows / late cancels, waiting-list uptake, revenue by service. */
export const ReportPanel = ({
  from,
  to,
  clinicId,
}: {
  from: string;
  to: string;
  clinicId: string;
}) => {
  const t = useTranslations('report');
  const f = useFormat();
  const { clinics } = useClinics();
  const city = (id: string): string => clinics.find((c) => c.id === id)?.city ?? '';
  const [{ data, fetching, error }] = useQuery({
    query: ReportDocument,
    variables: { from, to, clinicId: clinicId || null },
    pause: !from || !to,
  });
  if (!from || !to) return null;
  if (fetching && !data) return <Spinner />;
  if (error) return <ErrorNote code={errorCode(error)} />;
  const r = data?.report;
  if (!r) return null;
  return (
    <div className="flex flex-col gap-6" data-testid="report">
      <Card>
        <h2 className="mb-2 text-lg font-semibold">{t('rates')}</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div>
            <dt className="text-xs text-slate-600">{t('bookings')}</dt>
            <dd className="text-xl font-semibold tabular-nums" data-testid="bookings">
              {r.rates.bookings}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">{t('noShows')}</dt>
            <dd className="text-xl font-semibold tabular-nums">
              {pctFmt(r.rates.noShowPercent, f.locale)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">{t('lateCancels')}</dt>
            <dd className="text-xl font-semibold tabular-nums">
              {pctFmt(r.rates.lateCancelPercent, f.locale)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">{t('offered')}</dt>
            <dd className="text-xl font-semibold tabular-nums">{r.waitlist.offered}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">{t('accepted')}</dt>
            <dd className="text-xl font-semibold tabular-nums">
              {r.waitlist.accepted} ({pctFmt(r.waitlist.acceptedPercent, f.locale)})
            </dd>
          </div>
        </dl>
      </Card>
      <Card>
        <h2 className="mb-2 text-lg font-semibold">{t('revenue')}</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-600">
              <th scope="col">{t('service')}</th>
              <th scope="col" className="text-right">
                {t('visits', { count: 0 }).replace('0', '#')}
              </th>
              <th scope="col" className="text-right">
                ₴ / zł
              </th>
            </tr>
          </thead>
          <tbody>
            {r.revenue.map((x) => (
              <tr key={`${x.serviceId}-${x.currency}`} className="border-t border-slate-100">
                <td>{f.locale === 'en' ? x.nameEn : f.locale === 'pl' ? x.namePl : x.nameUk}</td>
                <td className="text-right tabular-nums">{t('visits', { count: x.visits })}</td>
                <td className="text-right tabular-nums">{f.money(x.revenueMinor, x.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card>
        <h2 className="mb-2 text-lg font-semibold">{t('utilization')}</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-600">
              <th scope="col">{t('doctor')}</th>
              <th scope="col" className="text-right">
                {t('percent')}
              </th>
            </tr>
          </thead>
          <tbody>
            {r.utilization.map((u) => (
              <tr key={`${u.doctorId}-${u.clinicId}`} className="border-t border-slate-100">
                <td>
                  {u.doctorName} · {city(u.clinicId)}
                </td>
                <td className="text-right tabular-nums">{pctFmt(u.percent, f.locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
};
