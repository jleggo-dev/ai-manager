import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import globals from 'globals';
import { sizeRules } from '../eslint.config.sizes.mjs';

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
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-non-null-assertion': 'warn',

      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-console': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  // Repo-wide size gates (source only; tests may be long). Offenders allowlisted below = backlog.
  {
    files: ['src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: { ...sizeRules },
  },
  // Size-gate backlog — EMPTY as of 2026-08-04: chat-sessions.ts (split into
  // routes/chat-sessions/* behind an order-preserving assembler) and chat-session-lifecycle.ts
  // (open/resume peeled to their own modules, re-exported for a stable import surface) were the
  // last two entries. Target zero, reached. If a file outgrows the gates, SPLIT it — never
  // resurrect this block to pass CI. (History: chat-messaging.ts + job-execution.ts cleared in
  // Phase 3; widget-health-checker.ts removed with its feature, PR #27.)
  {
    ignores: ['dist/', 'node_modules/'],
  },
];
