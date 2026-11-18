'use client';

import { useEffect } from 'react';
import { useQuery, useSubscription } from 'urql';
import { graphql } from '@/shared/api';
import type { AvailabilityQuery } from '@/shared/api';

export const AvailabilityDocument = graphql(`
  query Availability($input: AvailabilityInput!) {
    availability(input: $input) {
      clinicId timeZone currency durationMin priceMinor
      doctors { id fullName specialty }
      slots { doctorId startsAt endsAt localDate localTime }
    }
  }
`);

const AvailabilityChangedDocument = graphql(`
  subscription AvailabilityChanged($clinicId: ID!, $doctorId: ID) {
    availabilityChanged(clinicId: $clinicId, doctorId: $doctorId) { clinicId doctorId localDate }
  }
`);

export const AVAILABILITY_FIELDS = 'localDate localTime';
export type SlotData = NonNullable<AvailabilityQuery['availability']>['slots'][number];

/**
 * The free-time grid for one clinic/service (and optionally one doctor). It refetches by itself
 * when the server announces that a time was taken or released, so a second browser sees the change
 * without a reload.
 */
export const useAvailability = (p: { clinicId: string; serviceId: string; doctorId: string }) => {
  const paused = !p.clinicId || !p.serviceId;
  const [{ data, fetching, error }, refetch] = useQuery({
    query: AvailabilityDocument,
    variables: { input: { clinicId: p.clinicId, serviceId: p.serviceId, doctorId: p.doctorId || null } },
    pause: paused,
    requestPolicy: 'cache-and-network',
  });
  const [event] = useSubscription({ query: AvailabilityChangedDocument, variables: { clinicId: p.clinicId, doctorId: p.doctorId || null }, pause: paused });
  const stamp = event.data?.availabilityChanged;
  useEffect(() => {
    if (stamp) refetch({ requestPolicy: 'network-only' });
  }, [stamp]);
  return { availability: data?.availability ?? null, fetching, error, refetch: () => refetch({ requestPolicy: 'network-only' }) };
};
