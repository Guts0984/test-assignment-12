'use client';

import { useTranslations } from 'next-intl';
import { PageTitle } from '@/shared/ui';
import { SignUpForm } from '@/features/auth';

export const SignUpPage = () => {
  const t = useTranslations('auth');
  return (<><PageTitle>{t('signUpTitle')}</PageTitle><SignUpForm /></>);
};
