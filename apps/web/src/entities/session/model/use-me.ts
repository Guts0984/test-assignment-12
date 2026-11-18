'use client';

import { useQuery } from 'urql';
import { graphql } from '@/shared/api';
import type { MeQuery } from '@/shared/api';

export const MeDocument = graphql(`
  query Me {
    me {
      id
      role
      email
      fullName
      patientId
      clinicId
      doctorId
      locale
    }
  }
`);

export type Me = NonNullable<MeQuery['me']>;

export const useMe = () => {
  const [{ data, fetching, error }, refetch] = useQuery({ query: MeDocument });
  return {
    me: data?.me ?? null,
    fetching,
    error,
    refetch: () => refetch({ requestPolicy: 'network-only' }),
  };
};
