import fsd from '@feature-sliced/steiger-plugin';
import { defineConfig } from 'steiger';

export default defineConfig([
  ...fsd.configs.recommended,
  // Slices here are small and single-purpose on purpose (modular, tested apart); "used once, merge it"
  // is a style hint, and the app header is used by the Next.js layout outside src/.
  { files: ['./src/**'], rules: { 'fsd/insignificant-slice': 'off', 'fsd/excessive-slicing': 'off' } },
]);
