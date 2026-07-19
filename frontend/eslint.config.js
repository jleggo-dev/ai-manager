import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import react from 'eslint-plugin-react';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

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
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-non-null-assertion': 'warn',

      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-console': 'off',
    },
  },
  // FE-01: prevent organism/page files from regrowing into god-components.
  // Threshold is intentionally below the historical ProcessingJobManager size.
  // Known oversized files are overridden below as separately-tracked backlog —
  // do NOT add new files to that list; split them instead.
  {
    files: ['src/components/organisms/**/*.{ts,tsx}', 'src/pages/**/*.{ts,tsx}'],
    rules: {
      'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // Backlog (verified failing max-lines@500 after FE-01 + FE-02 merges — do not expand casually):
    // organisms: DiagnosticsTab, ai-profiles/{ProfileFormModal,TestChatPanel},
    //   processing-jobs/{AnalyticsTab,JobsTab,RuleSetsTab,SchemaValidationPanel}
    // pages: AiMatcherPage, HealthCheckWidgetPage, HealthDashboardPage, LovableGuidePage, SettingsPage
    // Note: AiProfileManager.tsx was removed after FE-02 split (orchestrator is well under 500).
    // HealthCheckProfilesPage dropped after FE-08 hook extraction (page is well under 500).
    // TestChatPanel size follow-up is FE-11; do not duplicate that ticket here.
    files: [
      'src/components/organisms/DiagnosticsTab.tsx',
      'src/components/organisms/ai-profiles/ProfileFormModal.tsx',
      'src/components/organisms/ai-profiles/TestChatPanel.tsx',
      'src/components/organisms/processing-jobs/AnalyticsTab.tsx',
      'src/components/organisms/processing-jobs/JobsTab.tsx',
      'src/components/organisms/processing-jobs/RuleSetsTab.tsx',
      'src/components/organisms/processing-jobs/SchemaValidationPanel.tsx',
      'src/pages/AiMatcherPage.tsx',
      'src/pages/HealthCheckWidgetPage.tsx',
      'src/pages/HealthDashboardPage.tsx',
      'src/pages/LovableGuidePage.tsx',
      'src/pages/SettingsPage.tsx',
    ],
    rules: {
      'max-lines': 'off',
    },
  },
];
