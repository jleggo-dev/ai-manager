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
  // Size-gate backlog — grandfathered offenders (refactoring_plan.md). Each split PR deletes an
  // entry; the target is zero. NEVER add a new file here to pass CI — split it instead.
  {
    files: [
      'src/routes/chat-sessions.ts', // ~1190 lines — largest file in the backend
      'src/ai-manager/chat-session-lifecycle.ts', // ~580 after leaf peel to chat-session-client.ts
      // chat-messaging.ts + job-execution.ts cleared from allowlist (Phase 3 residual)
      // widget-health-checker.ts removed with the feature (PR #27) — do not re-add.
    ],
    rules: { 'max-lines': 'off', 'max-lines-per-function': 'off' },
  },
  {
    ignores: ['dist/', 'node_modules/'],
  },
];
