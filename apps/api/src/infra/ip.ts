import ipaddr from 'ipaddr.js';

export type Cidr = [ipaddr.IPv4 | ipaddr.IPv6, number];

export const parseCidrs = (list: string): Cidr[] =>
  list
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ipaddr.parseCIDR(s) as Cidr);

/** Normalizes "::ffff:1.2.3.4" to "1.2.3.4" and lowercases IPv6; returns null for garbage. */
export const normalizeIp = (raw: string | undefined | null): string | null => {
  if (!raw) return null;
  try {
    let a = ipaddr.parse(raw.trim());
    if (a.kind() === 'ipv6' && (a as ipaddr.IPv6).isIPv4MappedAddress()) a = (a as ipaddr.IPv6).toIPv4Address();
    return a.toNormalizedString();
  } catch {
    return null;
  }
};

const inCidrs = (ip: string, cidrs: Cidr[]): boolean => {
  try {
    const a = ipaddr.parse(ip);
    return cidrs.some(([range, bits]) => a.kind() === range.kind() && a.match(range, bits));
  } catch {
    return false;
  }
};

export type HeaderGetter = (name: string) => string | undefined;

/**
 * The address rate limits and logs are keyed by.
 * Forwarding headers are believed ONLY when the TCP peer is a trusted proxy; otherwise a client
 * could put any address into X-Forwarded-For and dodge (or frame someone else with) the limits.
 * Behind a trusted proxy we walk X-Forwarded-For from the right and take the first address that is
 * not itself a trusted proxy.
 */
export const clientIp = (remote: string | undefined, header: HeaderGetter, trusted: Cidr[]): string => {
  const peer = normalizeIp(remote) ?? 'unknown';
  if (peer === 'unknown' || !inCidrs(peer, trusted)) return peer;
  const xff = header('x-forwarded-for');
  if (xff) {
    const hops = xff.split(',').map((h) => normalizeIp(h)).filter((h): h is string => h !== null);
    for (let i = hops.length - 1; i >= 0; i--) {
      const hop = hops[i] as string;
      if (!inCidrs(hop, trusted)) return hop;
    }
  }
  return normalizeIp(header('x-real-ip')) ?? peer;
};
