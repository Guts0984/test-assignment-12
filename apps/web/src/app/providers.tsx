'use client';

import { useMemo, type ReactNode } from 'react';
import { Provider } from 'urql';
import { createApiClient } from '@/shared/api';

/** One GraphQL client for the whole tab (HTTP with cookies + graphql-ws subscriptions). */
export const Providers = ({ children }: { children: ReactNode }) => {
  const client = useMemo(() => createApiClient(), []);
  return <Provider value={client}>{children}</Provider>;
};
