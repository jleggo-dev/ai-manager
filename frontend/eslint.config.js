import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import react from 'eslint-plugin-react';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import { fileRule, functionRule } from '../eslint.config.sizes.mjs';

export default [
  { ignores: ['dist', 'public/integration'] },
  {
    files: ['vite.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
      sourceType: 'module',
    },
  },
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    languageOptions: {
      parser: tsparser,
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      '@typescript-eslint': tseslint,
    },
    settings: {
      react: { version: '18.3' },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...tseslint.configs.recommended.rules,

      // eslint-plugin-react-hooks@7's "recommended" preset also enables the new React
      // Compiler rule bundle (static-components/purity/immutability/etc, mostly at
      // "error"), which is out of scope for this legacy codebase to adopt wholesale.
      // Keep only the two traditional hooks rules until that's a deliberate follow-up.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react/jsx-no-target-blank': 'warn',
      'react/prop-types': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

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
    },
  },
  // Repo-wide size gates (generalizes FE-01 from organisms/pages to all source; tests may be long).
  // Offenders are allowlisted below = the refactor backlog; every split PR deletes an entry, target
  // is zero. NEVER add a new file to the allowlist to pass CI — split it instead.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: { ...fileRule },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: { ...functionRule },
  },
  // Size-gate backlog — grandfathered offenders still over max-lines@500 after FE-03/04/06/08 and
  // widget-health removal (FE-05 cancelled). Each split PR deletes an entry; target is zero.
  // Dropped (under threshold or deleted): api.ts (FE-06), AiMatcherPage (FE-03), SettingsPage
  // (FE-04), HealthCheckWidgetPage (removed with widget health checker), ProfileFormModal (FE-14),
  // TestChatPanel (FE-11), JobsTab/AnalyticsTab/SchemaValidationPanel/RuleSetsTab (FE-13),
  // LovableGuidePage (FE-P2 lovable-guide), HealthDashboardPage (FE-P2 health-dashboard).
  // useHealthCheckProfilesData is under file-cap but over the new function-cap (FE-08 moved page
  // bulk into one hook) — keep until a follow-up split.
  {
    files: [
      'src/hooks/useHealthCheckProfilesData.ts', // FE-08 leftover — fn ~294 > 150
      'src/components/organisms/DiagnosticsTab.tsx',
    ],
    rules: { 'max-lines': 'off', 'max-lines-per-function': 'off' },
  },
];
