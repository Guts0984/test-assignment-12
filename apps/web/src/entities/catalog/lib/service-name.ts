export const serviceName = (s: { nameUk: string; nameEn: string; namePl: string }, locale: string): string =>
  locale === 'en' ? s.nameEn : locale === 'pl' ? s.namePl : s.nameUk;
