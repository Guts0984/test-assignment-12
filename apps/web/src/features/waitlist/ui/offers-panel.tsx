'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useSubscription } from 'urql';
import { useTranslations } from 'next-intl';
import { graphql } from '@/shared/api';
import { errorCode } from '@/shared/api';
import { Button, Card, ErrorNote } from '@/shared/ui';
import { useCountdown, mmss } from '@/shared/lib';
import { useFormat } from '@/shared/lib';
import { newKey } from '@/shared/lib';

const OffersDocument = graphql(`
  query MyOffers { myOffers { id expiresAt appointment { id startsAt clinic { timeZone } doctor { fullName } } } }
`);
const OfferEventDocument = graphql(`subscription OfferWatch { myAppointmentChanged { id status } }`);
const AcceptDocument = graphql(`mutation AcceptOffer($input: RespondOfferInput!) { acceptOffer(input: $input) { id status } }`);
const DeclineDocument = graphql(`mutation DeclineOffer($id: ID!) { declineOffer(id: $id) }`);

type Offer = { id: string; expiresAt: string; appointment?: { startsAt: string; clinic: { timeZone: string }; doctor: { fullName: string } } | null };

const OfferRow = ({ offer, onDone }: { offer: Offer; onDone: () => void }) => {
  const t = useTranslations('cabinet');
  const f = useFormat();
  const [, accept] = useMutation(AcceptDocument);
  const [, decline] = useMutation(DeclineDocument);
  const [code, setCode] = useState<string | null>(null);
  const [key] = useState(newKey);
  const left = useCountdown(new Date(offer.expiresAt));
  const tz = offer.appointment?.clinic.timeZone ?? 'UTC';
  // the offer ran out: stop showing it (the server has already passed it on) and refresh the list
  useEffect(() => { if (left === 0) onDone(); }, [left]);
  if (left === 0) return null;
  return (
    <Card as="article" data-testid="offer">
      <p className="text-sm">{t('offerText', { when: offer.appointment ? f.dateTime(offer.appointment.startsAt, tz) : '', until: f.time(offer.expiresAt, tz) })}</p>
      <p className="text-xs tabular-nums text-slate-600">{mmss(left)}</p>
      <ErrorNote code={code} />
      <div className="mt-2 flex gap-2">
        <Button data-testid="accept-offer" disabled={left === 0} onClick={async () => {
          const r = await accept({ input: { offerId: offer.id, idempotencyKey: key } });
          if (r.error) setCode(errorCode(r.error)); else onDone();
        }}>{t('accept')}</Button>
        <Button variant="secondary" onClick={async () => { const r = await decline({ id: offer.id }); if (r.error) setCode(errorCode(r.error)); else onDone(); }}>{t('decline')}</Button>
      </div>
    </Card>
  );
};

/** Open waiting-list offers of the signed-in patient, live: a new offer appears without reloading. */
export const OffersPanel = ({ onChanged }: { onChanged: () => void }) => {
  const t = useTranslations('cabinet');
  const [{ data }, refetch] = useQuery({ query: OffersDocument, requestPolicy: 'cache-and-network' });
  const [ev] = useSubscription({ query: OfferEventDocument });
  const stamp = ev.data?.myAppointmentChanged?.id;
  const [seen, setSeen] = useState<string | undefined>();
  if (stamp && stamp !== seen) { setSeen(stamp); refetch({ requestPolicy: 'network-only' }); }
  const offers = data?.myOffers ?? [];
  if (offers.length === 0) return null;
  return (
    <section aria-labelledby="offers-title" className="mb-6">
      <h2 id="offers-title" className="mb-2 text-lg font-semibold">{t('offers')}</h2>
      <div className="flex flex-col gap-2">{offers.map((o) => <OfferRow key={o.id} offer={o as Offer} onDone={() => { refetch({ requestPolicy: 'network-only' }); onChanged(); }} />)}</div>
    </section>
  );
};
