import { RateLimiterMemory, RateLimiterRedis, type RateLimiterAbstract } from 'rate-limiter-flexible';
import type { Redis } from 'ioredis';

export type LimitRule = { points: number; durationSec: number };
export type LimitResult = { ok: true } | { ok: false; retryAfterSec: number };

export type Limiter = { consume: (key: string) => Promise<LimitResult> };

/**
 * A fixed-window limiter shared by all API replicas through Redis. If Redis is unreachable the
 * in-process limiter (`insurance`) takes over, so limits keep working (per replica) instead of
 * failing open or taking the API down.
 */
export const createLimiter = (name: string, rule: LimitRule, redis: Redis | null): Limiter => {
  const memory = new RateLimiterMemory({ keyPrefix: `rl:${name}`, points: rule.points, duration: rule.durationSec });
  const limiter: RateLimiterAbstract = redis
    ? new RateLimiterRedis({
        storeClient: redis,
        keyPrefix: `rl:${name}`,
        points: rule.points,
        duration: rule.durationSec,
        insuranceLimiter: memory,
        rejectIfRedisNotReady: true,
      })
    : memory;
  return {
    consume: async (key) => {
      try {
        await limiter.consume(key, 1);
        return { ok: true };
      } catch (e) {
        const ms = (e as { msBeforeNext?: number }).msBeforeNext;
        if (typeof ms === 'number') return { ok: false, retryAfterSec: Math.max(1, Math.ceil(ms / 1000)) };
        // an unexpected limiter failure must not become an outage
        return { ok: true };
      }
    },
  };
};
