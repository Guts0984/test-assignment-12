import { Client, cacheExchange, fetchExchange, subscriptionExchange, type CombinedError } from 'urql';
import { createClient as createWsClient } from 'graphql-ws';
import { env, resolveWsUrl } from '../config';

/** One urql client per browser tab: cookies on every request, subscriptions over graphql-ws. */
export const createApiClient = (): Client => {
  const ws = createWsClient({ url: resolveWsUrl, lazy: true, retryAttempts: Infinity, shouldRetry: () => true });
  return new Client({
    url: env.apiUrl,
    // POST only: the API refuses simple GET queries (CSRF prevention)
    preferGetMethod: false,
    fetchOptions: { credentials: 'include' },
    exchanges: [
      cacheExchange,
      fetchExchange,
      subscriptionExchange({
        forwardSubscription: (request) => ({
          subscribe: (sink) => ({
            unsubscribe: ws.subscribe({ query: request.query ?? '', variables: request.variables as Record<string, unknown> | undefined }, sink as never),
          }),
        }),
      }),
    ],
  });
};

type Extensions = { code?: string; fieldErrors?: Record<string, string>; retryAfterSec?: number };

/** The API's stable error code, or `network` when the server could not be reached. */
export const errorCode = (e: CombinedError | undefined): string | null => {
  if (!e) return null;
  const first = e.graphQLErrors[0];
  if (first) return (first.extensions as Extensions | undefined)?.code ?? 'INTERNAL_SERVER_ERROR';
  if (e.networkError) {
    const status = (e.response as Response | undefined)?.status;
    return status === 429 ? 'RATE_LIMITED' : 'network';
  }
  return 'INTERNAL_SERVER_ERROR';
};

export const fieldErrorsOf = (e: CombinedError | undefined): Record<string, string> =>
  ((e?.graphQLErrors[0]?.extensions as Extensions | undefined)?.fieldErrors) ?? {};
