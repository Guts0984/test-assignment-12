import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// Classes are allowed only where NestJS needs them (api, worker).
const NEST_APPS = ['apps/api/**', 'apps/worker/**'];

export default tseslint.config(
  { ignores: ['**/next-env.d.ts', '**/dist/**', '**/.next/**', '**/node_modules/**', '**/generated/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': 'allow-with-description', 'ts-expect-error': 'allow-with-description', minimumDescriptionLength: 10 },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-syntax': [
        'error',
        { selector: 'ClassDeclaration', message: 'Functional style only: classes are allowed just for NestJS (apps/api, apps/worker).' },
        { selector: 'ClassExpression', message: 'Functional style only: classes are allowed just for NestJS.' },
      ],
    },
  },
  {
    files: NEST_APPS,
    rules: { 'no-restricted-syntax': 'off' },
  },
);
