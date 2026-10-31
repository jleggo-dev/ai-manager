import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';

/**
 * The weekly coach probe (`.github/workflows/probe-coach.yml`) has an AI Admin key and no DB
 * secret, on purpose: it calls the deployed jobs and checks their output through the app's own
 * normalizers. Any app module it imports must therefore load without the DB config.
 *
 * `probe-coach-tools.ts` imported `normalizeDetour` from `detour-capture.ts`, which also imports
 * the episode repo → `db/sql.ts` → `config.ts`, and `config.ts` throws when no DB password is set.
 * Locally the `.env` supplies one, so nobody saw it; in Actions the tool-choice step crashed at
 * startup on every scheduled run from at least 2026-09-07 to 2026-10-26.
 *
 * Here the DB config throws if anything reaches it, and every `../src/` module each probe imports
 * is loaded under that rule.
 */
vi.mock('../src/config.ts', () => {
  throw new Error('a probe import reached src/config.ts (the DB config) — the probe has no DB secret');
});

const here = path.dirname(fileURLToPath(import.meta.url));
const PROBES = ['probe-coach-tools.ts', 'probe-plan-shape.ts', 'probe-lib.ts'];

function appImports(file: string): string[] {
  const src = readFileSync(path.join(here, file), 'utf8');
  return [...src.matchAll(/from '(\.\.\/src\/[^']+)'/g)].map((m) => m[1]!);
}

describe('the coach probe loads without a DB secret', () => {
  it('finds the app modules the probes import (so the check below is not vacuous)', () => {
    const all = PROBES.flatMap(appImports);
    expect(all).toContain('../src/services/detour-normalize.ts');
    expect(all).toContain('../src/services/session-normalize.ts');
  });

  for (const probe of PROBES) {
    for (const mod of appImports(probe)) {
      it(`${probe} → ${mod} does not load the DB config`, async () => {
        await expect(import(/* @vite-ignore */ mod)).resolves.toBeDefined();
      });
    }
  }

  it('the old import really did load the DB config (the guard can go red)', async () => {
    // vitest rewraps a throwing mock factory in its own message, so assert the rejection alone.
    await expect(import('../src/services/detour-capture.ts')).rejects.toThrow();
  });
});
