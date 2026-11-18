import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

const withNextIntl = createNextIntlPlugin('./src/shared/i18n/request.ts');

const config: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@clinic/shared'],
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true }, // linted by the repo-level ESLint in CI
  reactStrictMode: true,
  // the GraphQL API is reached through the same origin (nginx in compose), or through
  // NEXT_PUBLIC_API_URL when the web app runs on its own (dev / e2e)
};

export default withNextIntl(config);
