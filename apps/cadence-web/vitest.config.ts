/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    /**
     * Fixed, fake auth env for every run. Without it the suite reads whatever `.env` the developer
     * happens to have, so a test that needs these passes locally and fails in CI — which is exactly
     * how the boot-cache suite was found. `createClient` also throws outright on an empty URL, so a
     * missing value takes down every file that transitively imports `lib/supabase.ts`, not just the
     * one that meant to use it. These are syntactically valid and point at nothing.
     */
    env: {
      VITE_CADENCE_SUPABASE_URL: 'https://zzqtest.supabase.co',
      VITE_CADENCE_SUPABASE_ANON_KEY: 'zzq-test-anon-key',
    },
  },
});
