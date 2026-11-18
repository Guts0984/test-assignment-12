import { Suspense, type ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { routing } from '@/shared/i18n/routing';
import { Providers } from '@/app/providers';
import { AppHeader } from '@/widgets/app-header';
import '../globals.css';

export const generateStaticParams = () => routing.locales.map((locale) => ({ locale }));

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const messages = await getMessages();
  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>
            <Suspense>
              <AppHeader />
            </Suspense>
            <main id="main" className="mx-auto max-w-6xl px-4 py-6">
              <Suspense>{children}</Suspense>
            </main>
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
