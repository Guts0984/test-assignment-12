import type { CodegenConfig } from '@graphql-codegen/cli';

// Types come ONLY from the API schema; nothing about a response is written by hand.
const config: CodegenConfig = {
  schema: '../api/schema.gql',
  documents: ['src/**/*.{ts,tsx}', '!src/shared/api/generated/**'],
  ignoreNoDocuments: true,
  generates: {
    './src/shared/api/generated/': {
      preset: 'client',
      presetConfig: { fragmentMasking: false },
      config: { useTypeImports: true, enumsAsTypes: true, skipTypename: false },
    },
  },
  hooks: { afterAllFileWrite: [] },
};

export default config;
