/** Deterministic PRNG (mulberry32) and small helpers. Functional: state lives in a closure. */
export type Rng = {
  next: () => number;
  int: (min: number, maxInclusive: number) => number;
  chance: (p: number) => boolean;
  pick: <T>(items: readonly T[]) => T;
  weighted: <T>(items: readonly (readonly [T, number])[]) => T;
  uuid: () => string;
};

export const createRng = (seed: number): Rng => {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)] as T;
  const weighted = <T>(items: readonly (readonly [T, number])[]): T => {
    const total = items.reduce((s, [, w]) => s + w, 0);
    let r = next() * total;
    for (const [v, w] of items) {
      r -= w;
      if (r < 0) return v;
    }
    return (items[items.length - 1] as readonly [T, number])[0];
  };
  const uuid = (): string => {
    const h = Array.from({ length: 32 }, () => int(0, 15).toString(16));
    h[12] = '4';
    h[16] = '89ab'[int(0, 3)] as string;
    return `${h.slice(0, 8).join('')}-${h.slice(8, 12).join('')}-${h.slice(12, 16).join('')}-${h.slice(16, 20).join('')}-${h.slice(20).join('')}`;
  };
  return { next, int, chance: (p) => next() < p, pick, weighted, uuid };
};
