'use client';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { PageTitle } from '@/shared/ui';
import { SignInForm } from '@/features/auth';

export const SignInPage = () => {
  const t = useTranslations('auth');
  const next = useSearchParams()?.get('next') ?? undefined;
  return (<><PageTitle>{t('signInTitle')}</PageTitle><SignInForm next={next} /></>);
};
