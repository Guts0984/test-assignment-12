'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from 'urql';
import { useLocale, useTranslations } from 'next-intl';
import { signUpSchema, type SignUpInput } from '@clinic/shared';
import { graphql } from '@/shared/api';
import { errorCode } from '@/shared/api';
import { Button, ErrorNote, TextField } from '@/shared/ui';
import { Link } from '@/shared/i18n';
import { useFieldMessages } from '../model/use-form-errors';

const SignUpDocument = graphql(`mutation SignUp($input: SignUpInput!) { signUp(input: $input) { id role } }`);

type FormValues = { email: string; password: string; fullName: string; phone: string };

export const SignUpForm = () => {
  const t = useTranslations('auth');
  const c = useTranslations('common');
  const locale = useLocale();
  const [, signUp] = useMutation(SignUpDocument);
  const [code, setCode] = useState<string | null>(null);
  const { message, applyServerErrors } = useFieldMessages();
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<FormValues>({ resolver: zodResolver(signUpSchema) as never });

  const onSubmit = handleSubmit(async (values) => {
    setCode(null);
    const r = await signUp({ input: { ...values, locale: locale as SignUpInput['locale'] } as never });
    if (r.error) {
      const hadFields = applyServerErrors(r.error, setError);
      setCode(hadFields && errorCode(r.error) === 'BAD_USER_INPUT' ? null : errorCode(r.error));
      return;
    }
    window.location.assign(`/${locale}`);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-sm flex-col gap-4" aria-label={t('signUpTitle')}>
      <TextField label={t('fullName')} autoComplete="name" {...register('fullName')} error={message('fullName', errors)} />
      <TextField label={t('email')} type="email" autoComplete="email" {...register('email')} error={message('email', errors)} />
      <TextField label={t('phone')} type="tel" autoComplete="tel" placeholder="+380501234567" {...register('phone')} error={message('phone', errors)} />
      <TextField label={t('password')} type="password" autoComplete="new-password" {...register('password')} error={message('password', errors)} />
      <ErrorNote code={code} />
      <Button type="submit" disabled={isSubmitting}>{c('signUp')}</Button>
      <p className="text-sm text-slate-700">{t('haveAccount')} <Link className="text-sky-800 underline" href="/sign-in">{c('signIn')}</Link></p>
    </form>
  );
};
