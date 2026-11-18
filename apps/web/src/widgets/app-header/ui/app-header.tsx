'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/shared/i18n';
import { useMe, SignOutButton } from '@/entities/session';
import { LocaleSwitch } from '@/features/locale-switch';

export const AppHeader = () => {
  const t = useTranslations('common');
  const r = useTranslations('registrar');
  const { me } = useMe();
  const nav: { href: string; label: string; show: boolean }[] = [
    { href: '/', label: t('book'), show: !me || me.role === 'patient' },
    { href: '/cabinet', label: t('cabinet'), show: me?.role === 'patient' },
    { href: '/registrar', label: r('boardTitle'), show: me?.role === 'registrar' },
    { href: '/registrar/phone', label: r('phoneBooking'), show: me?.role === 'registrar' },
    { href: '/registrar/schedule', label: r('schedule'), show: me?.role === 'registrar' },
    { href: '/doctor', label: t('doctor'), show: me?.role === 'doctor' },
    { href: '/manager/report', label: t('report'), show: me?.role === 'manager' },
  ];
  return (
    <header className="border-b border-slate-200 bg-white">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:rounded focus:bg-white focus:p-2"
      >
        {t('skipToContent')}
      </a>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="text-lg font-semibold text-sky-900">
          {t('appName')}
        </Link>
        <nav aria-label="main" className="flex flex-wrap items-center gap-3 text-sm">
          {nav
            .filter((n) => n.show)
            .map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="rounded px-2 py-1 text-sky-900 hover:bg-sky-50"
              >
                {n.label}
              </Link>
            ))}
          {me ? (
            <>
              <span className="text-slate-600" data-testid="me-email">
                {me.email}
              </span>
              <SignOutButton />
            </>
          ) : (
            <>
              <Link href="/sign-in" className="rounded px-2 py-1 text-sky-900 hover:bg-sky-50">
                {t('signIn')}
              </Link>
              <Link href="/sign-up" className="rounded px-2 py-1 text-sky-900 hover:bg-sky-50">
                {t('signUp')}
              </Link>
            </>
          )}
          <LocaleSwitch />
        </nav>
      </div>
    </header>
  );
};
