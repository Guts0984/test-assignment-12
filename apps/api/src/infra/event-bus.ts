import { PubSub } from 'graphql-subscriptions';
import type { Redis } from 'ioredis';
import { decodeEvent, encodeEvent, EVENTS_CHANNEL, type ClinicEvent } from '@clinic/shared';

export const TOPIC = 'clinic-events';

export type EventBus = {
  pubsub: PubSub;
  /** Publishes to every replica (including this one) through Redis. Best effort. */
  publish: (e: ClinicEvent) => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

/**
 * Live events travel worker/api → Redis channel → every api replica → in-process PubSub → the
 * subscription resolvers, which filter per subscriber. Losing Redis loses live updates only:
 * clients refetch when they reconnect.
 */
export const createEventBus = (
  publisher: Redis,
  subscriberFactory: () => Redis,
  onError: (m: string) => void,
): EventBus => {
  const pubsub = new PubSub();
  let sub: Redis | undefined;
  return {
    pubsub,
    publish: async (e) => {
      try {
        await publisher.publish(EVENTS_CHANNEL, encodeEvent(e));
      } catch (err) {
        onError(`event publish failed: ${String(err)}`);
      }
    },
    start: async () => {
      sub = subscriberFactory();
      sub.on('error', () => undefined);
      sub.on('message', (_c, raw) => {
        const e = decodeEvent(raw);
        if (e) void pubsub.publish(TOPIC, e);
      });
      // subscribe() is retried by ioredis on reconnect (autoResubscribe)
      await sub
        .subscribe(EVENTS_CHANNEL)
        .catch((err) => onError(`event subscribe failed: ${String(err)}`));
    },
    stop: async () => {
      sub?.disconnect();
    },
  };
};
