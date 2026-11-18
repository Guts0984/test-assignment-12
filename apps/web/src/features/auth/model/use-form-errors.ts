'use client';

import { useTranslations } from 'next-intl';
import type { FieldErrors, FieldValues, UseFormSetError, Path } from 'react-hook-form';
import { fieldErrorsOf } from '@/shared/api';
import type { CombinedError } from 'urql';

/** Field-level messages in the user's language, for client (zod) and server (extensions.fieldErrors) errors alike. */
export const useFieldMessages = () => {
  const t = useTranslations('validation');
  const known = ['email', 'password', 'fullName', 'phone', 'date', 'range', 'time'];
  const message = (
    field: string,
    errors: FieldErrors<FieldValues>,
    key?: string,
  ): string | undefined => {
    if (!errors[field]) return undefined;
    return t((key ?? (known.includes(field) ? field : 'generic')) as 'generic');
  };
  const applyServerErrors = <T extends FieldValues>(
    e: CombinedError | undefined,
    setError: UseFormSetError<T>,
  ): boolean => {
    const fe = fieldErrorsOf(e);
    const names = Object.keys(fe);
    for (const n of names) setError(n as Path<T>, { type: 'server', message: fe[n] });
    return names.length > 0;
  };
  return { message, applyServerErrors };
};
