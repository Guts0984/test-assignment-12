import { describe, expect, it } from 'vitest';
import { clientIp, normalizeIp, parseCidrs } from '../src/infra/ip.js';
import { loadApiEnv } from '../src/env.js';

describe('api env', () => {
  it('fails fast without the database url, defaults everything non-secret', () => {
    expect(() => loadApiEnv({})).toThrow(/DATABASE_URL/);
    const e = loadApiEnv({ DATABASE_URL: 'postgres://x' });
    expect(e).toMatchObject({ NODE_ENV: 'development', PORT: 4000, COOKIE_SECURE: false, GQL_MAX_DEPTH: 10, RATE_GLOBAL_PER_MIN: 300, RATE_SIGNIN_PER_MIN: 5, RATE_SIGNUP_PER_HOUR: 5, RATE_HOLD_PER_MIN: 10, TRUST_PROXY_CIDRS: '', HOLD_TTL_SECONDS: 600 });
  });
  it('rejects nonsense', () => {
    for (const bad of [{ PORT: '70000' }, { NODE_ENV: 'staging' }, { GQL_MAX_DEPTH: '0' }, { COOKIE_SECURE: 'maybe' }, { ARGON_MEMORY_KIB: '10' }]) expect(() => loadApiEnv({ DATABASE_URL: 'x', ...bad })).toThrow();
  });
});

describe('client address resolution', () => {
  const h = (m: Record<string, string>) => (n: string) => m[n];
  const none = parseCidrs('');
  const proxy = parseCidrs('10.0.0.0/8, 172.16.0.0/12, ::1/128');
  it('without trusted proxies the socket address wins, whatever the headers say', () => {
    expect(clientIp('203.0.113.5', h({ 'x-forwarded-for': '1.1.1.1', 'x-real-ip': '2.2.2.2' }), none)).toBe('203.0.113.5');
  });
  it('IPv4-mapped IPv6 is normalized so one client has one key', () => {
    expect(clientIp('::ffff:203.0.113.5', h({}), none)).toBe('203.0.113.5');
    expect(normalizeIp('::FFFF:1.2.3.4')).toBe('1.2.3.4');
    expect(normalizeIp('2001:DB8::1')).toBe(normalizeIp('2001:db8:0:0:0:0:0:1'));
  });
  it('behind a trusted proxy: rightmost address that is not itself a proxy', () => {
    expect(clientIp('10.0.0.2', h({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }), proxy)).toBe('203.0.113.9');
    expect(clientIp('10.0.0.2', h({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9, 10.1.1.1' }), proxy)).toBe('203.0.113.9'); // chain of proxies
    expect(clientIp('10.0.0.2', h({ 'x-real-ip': '203.0.113.77' }), proxy)).toBe('203.0.113.77');
  });
  it('garbage headers fall back to the peer instead of becoming a key', () => {
    expect(clientIp('10.0.0.2', h({ 'x-forwarded-for': 'not an ip, <script>' }), proxy)).toBe('10.0.0.2');
    expect(clientIp('10.0.0.2', h({ 'x-forwarded-for': ''.padEnd(5000, 'a') }), proxy)).toBe('10.0.0.2');
    expect(clientIp(undefined, h({}), proxy)).toBe('unknown');
  });
  it('a peer outside the trusted ranges cannot use the headers', () => {
    expect(clientIp('198.51.100.1', h({ 'x-forwarded-for': '9.9.9.9' }), proxy)).toBe('198.51.100.1');
  });
});
