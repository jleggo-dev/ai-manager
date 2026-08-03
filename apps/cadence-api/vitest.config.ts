import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The DB integration suites (plan-commit, nutrition-service, recipe) talk to a REAL remote
    // Postgres through the Supabase pooler — ~1.7s just to connect, then a seed-and-wipe per test.
    // vitest's 5s default fails them on latency alone, which reads as "6 broken tests" on a dev
    // machine and wastes an investigation. They skip entirely in CI (no CADENCE_* secrets), so this
    // only affects local runs. Raise it here rather than per-file so the next DB suite inherits it.
    testTimeout: 30_000,
  },
});
