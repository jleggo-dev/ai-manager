import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import react from 'eslint-plugin-react';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import { fileRule, functionRule } from '../../eslint.config.sizes.mjs';

export default [
  { ignores: ['dist', 'node_modules'] },
  {
    files: ['vite.config.ts'],
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

      // See frontend/eslint.config.js for why we don't spread reactHooks.configs.recommended
      // wholesale: v7's preset also enables the new React Compiler rule bundle, out of
      // scope here. Keep only the two traditional hooks rules for now.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react/jsx-no-target-blank': 'warn',
      'react/prop-types': 'off',
      // Brand contractions stay as JS string literals in JSX ({"here's"}) so the rule
      // can stay on without &apos; clutter or voice changes (docs/cadence/BRAND.md).
      'react/no-unescaped-entities': 'error',
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
      // Same rationale as apps/cadence-api/eslint.config.js — existing code already uses
      // `!` deliberately in several places; enabling this now would be an out-of-scope
      // refactor rather than a small fix.
      '@typescript-eslint/no-non-null-assertion': 'off',

      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-console': 'off',
    },
  },
  // Repo-wide size gates (source only; tests may be long).
  // File-cap on all source; function-cap on .ts logic only (JSX render bodies run long by nature).
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
  // Size-gate backlog is empty for cadence-web (WEB-01 + WEB-03 cleared). NEVER add a new
  // grandfather entry — split the file instead.
];
