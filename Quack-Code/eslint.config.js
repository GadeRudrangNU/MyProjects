import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/drizzle/**', '**/.pgdata/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Shipped as text into the sandbox iframe and its worker, so they use browser/worker globals.
    files: ['apps/web/src/sandbox/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        self: 'readonly', window: 'readonly', performance: 'readonly', importScripts: 'readonly',
        Worker: 'readonly', Blob: 'readonly', URL: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly', __CONFIG__: 'readonly', __WORKER_SOURCE__: 'readonly',
      },
    },
  },
  {
    files: ['apps/web/scripts/*.mjs'],
    languageOptions: { globals: { console: 'readonly' } },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
