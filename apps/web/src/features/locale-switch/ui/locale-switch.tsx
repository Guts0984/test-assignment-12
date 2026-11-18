'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter, routing } from '@/shared/i18n';
import { useSearchParams } from 'next/navigation';

const LABEL: Record<string, string> = { uk: 'UA', en: 'EN', pl: 'PL' };

export const LocaleSwitch = () => {
  const locale = useLocale();
  const t = useTranslations('common');
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  return (
    <div role="group" aria-label={t('language')} className="flex gap-1">
      {routing.locales.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={l === locale}
          onClick={() =>
            router.replace(`${pathname}${params?.toString() ? `?${params.toString()}` : ''}`, {
              locale: l,
            })
          }
          className={`rounded px-2 py-1 text-sm focus-visible:outline-2 focus-visible:outline-sky-700 ${l === locale ? 'bg-sky-700 text-white' : 'text-sky-900 hover:bg-sky-50'}`}
        >
          {LABEL[l]}
        </button>
      ))}
    </div>
  );
};
