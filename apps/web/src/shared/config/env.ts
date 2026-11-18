import { z } from 'zod';

// Public configuration, inlined at build time. Defaults suit the compose stack (one origin).
const schema = z.object({
  /** GraphQL HTTP endpoint the browser calls. */
  apiUrl: z.string().default('/graphql'),
  /** GraphQL WebSocket endpoint; empty = derive from the page origin. */
  wsUrl: z.string().default(''),
});

export const env = schema.parse({
  // dot access on purpose: Next only inlines NEXT_PUBLIC_* written as process.env.NAME
  apiUrl: process.env.NEXT_PUBLIC_API_URL || undefined,
  wsUrl: process.env.NEXT_PUBLIC_WS_URL || undefined,
});

export const resolveWsUrl = (): string => {
  if (env.wsUrl) return env.wsUrl;
  if (env.apiUrl.startsWith('http')) return env.apiUrl.replace(/^http/, 'ws');
  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}${env.apiUrl}`;
};
