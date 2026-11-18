'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/shared/ui';

const TONE = { held: 'amber', booked: 'sky', checked_in: 'green', completed: 'green', no_show: 'rose', cancelled: 'slate' } as const;

export const StatusBadge = ({ status }: { status: keyof typeof TONE }) => {
  const t = useTranslations('status');
  return <Badge tone={TONE[status]}>{t(status)}</Badge>;
};
