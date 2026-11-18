'use client';

import { useEffect, useState } from 'react';

/** Seconds left until `until` (ticks once a second; 0 when over). */
export const useCountdown = (until: Date | null): number => {
  const calc = (): number =>
    until ? Math.max(0, Math.ceil((until.getTime() - Date.now()) / 1000)) : 0;
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    setLeft(calc());
    if (!until) return;
    const id = setInterval(() => setLeft(calc()), 500);
    return () => clearInterval(id);
  }, [until?.getTime()]);
  return left;
};

export const mmss = (s: number): string =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
