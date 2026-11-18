'use client';

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePathname, useRouter } from '../i18n';

/**
 * Filters live in the URL, not in component state: a reload, the Back button and a shared link all
 * restore the same view. Empty values are dropped from the query string.
 */
export const useUrlState = <K extends string>(keys: readonly K[]) => {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const values = useMemo(() => Object.fromEntries(keys.map((k) => [k, params?.get(k) ?? ''])) as Record<K, string>, [params, keys]);
  const set = useCallback(
    (patch: Partial<Record<K, string>>, mode: 'push' | 'replace' = 'push') => {
      const next = new URLSearchParams(params?.toString() ?? '');
      for (const [k, v] of Object.entries(patch) as [string, string | undefined][]) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      const qs = next.toString();
      const href = `${pathname}${qs ? `?${qs}` : ''}`;
      if (mode === 'replace') router.replace(href);
      else router.push(href);
    },
    [params, pathname, router],
  );
  return [values, set] as const;
};
