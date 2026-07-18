import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import globals from 'globals';

export default [
  {
    files: ['**/*.ts', '**/*.mjs'],
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs.recommended.rules,

      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      // This codebase already relies heavily and deliberately on `!` (e.g. after
      // route-param/regex-match guards) — enabling this as a lint-baseline rule now
      // would require a large, out-of-scope refactor rather than a small fix. Revisit
      // as its own ticket if the team wants to migrate off non-null assertions.
      '@typescript-eslint/no-non-null-assertion': 'off',

      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-console': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  {
    // One-off manual admin/ops scripts (see CLAUDE.md: sync-jobs.ts/provision-aim.ts) that
    // deliberately shell out to untyped JSON HTTP responses — relaxing `no-explicit-any`
    // here avoids modeling those response shapes just to satisfy lint, without weakening
    // the rule for actual application source in src/.
    files: ['scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    ignores: ['dist/', 'node_modules/'],
  },
];
