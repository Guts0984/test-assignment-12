'use client';

import { useMutation } from 'urql';
import { useTranslations } from 'next-intl';
import { graphql } from '@/shared/api';
import { Button } from '@/shared/ui';
import { useRouter } from '@/shared/i18n';

const SignOutDocument = graphql(`mutation SignOut { signOut }`);

export const SignOutButton = () => {
  const t = useTranslations('common');
  const [, signOut] = useMutation(SignOutDocument);
  const router = useRouter();
  return (
    <Button variant="ghost" onClick={async () => { await signOut({}); window.location.assign(`/${document.documentElement.lang}`); void router; }}>
      {t('signOut')}
    </Button>
  );
};
