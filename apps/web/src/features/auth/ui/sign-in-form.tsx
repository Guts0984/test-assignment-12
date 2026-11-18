'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from 'urql';
import { useTranslations } from 'next-intl';
import { signInSchema, type SignInInput } from '@clinic/shared';
import { graphql } from '@/shared/api';
import { errorCode } from '@/shared/api';
import { Button, ErrorNote, TextField } from '@/shared/ui';
import { Link } from '@/shared/i18n';
import { useFieldMessages } from '../model/use-form-errors';
import { homeFor } from '../model/home-for';

const SignInDocument = graphql(`
  mutation SignIn($input: SignInInput!) {
    signIn(input: $input) {
      id
      role
    }
  }
`);

export const SignInForm = ({ next }: { next?: string }) => {
  const t = useTranslations('auth');
  const c = useTranslations('common');
  const [, signIn] = useMutation(SignInDocument);
  const [code, setCode] = useState<string | null>(null);
  const { message, applyServerErrors } = useFieldMessages();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignInInput>({ resolver: zodResolver(signInSchema) as never });

  const onSubmit = handleSubmit(async (values) => {
    setCode(null);
    const r = await signIn({ input: values });
    if (r.error) {
      if (!applyServerErrors(r.error, setError)) setCode(errorCode(r.error));
      else setCode(errorCode(r.error) === 'BAD_USER_INPUT' ? null : errorCode(r.error));
      return;
    }
    const role = r.data?.signIn.role ?? 'patient';
    window.location.assign(
      next && next.startsWith('/') ? next : `/${document.documentElement.lang}${homeFor(role)}`,
    );
  });

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex max-w-sm flex-col gap-4"
      aria-label={t('signInTitle')}
    >
      <TextField
        label={t('email')}
        type="email"
        autoComplete="email"
        {...register('email')}
        error={message('email', errors)}
      />
      <TextField
        label={t('password')}
        type="password"
        autoComplete="current-password"
        {...register('password')}
        error={message('password', errors, 'passwordRequired')}
      />
      <ErrorNote code={code} />
      <Button type="submit" disabled={isSubmitting}>
        {c('signIn')}
      </Button>
      <p className="text-sm text-slate-700">
        {t('noAccount')}{' '}
        <Link className="text-sky-800 underline" href="/sign-up">
          {c('signUp')}
        </Link>
      </p>
    </form>
  );
};
