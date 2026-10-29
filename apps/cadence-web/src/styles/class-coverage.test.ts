/**
 * Every class a component names has a rule somewhere in the stylesheets under src.
 *
 * On 2026-10-28 a refactor of styles.css meant to drop one family of rules took 3,300 lines
 * with it — the quick-add sheet, the Food screen, the journal, detours, the weather sheet and
 * five Settings screens all lost their styling, and nothing in the suite noticed: jsdom does no
 * layout, every component still rendered, every test still passed. The owner found it on the
 * phone. This is the cheap check that a class a component asks for is still defined.
 *
 * Only static `className="…"` literals are read — a token built at runtime is out of reach
 * here, and the static ones are plenty to catch a lost block. Roots that have never had a rule
 * (a wrapper that exists for its children's selectors) are listed below; adding to that list is
 * the wrong fix for a class that used to be styled.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Wrapper roots with no rule of their own (their children carry the selectors). Pre-existing. */
const BARE_ROOTS = new Set([
  'cfm-goal',
  'detour-sheet',
  'eot-card',
  'fd-ring',
  'fork',
  'fq-row-plain',
  'is-warming',
  'ld',
  'ms-in-door',
  'ms-title-name',
  'pv',
  'pw-rep-note',
  'qp-list',
  'rc-actions',
  'rc-count',
  'rc-name',
  'rc-row',
  'read',
  'ri-add-collection',
  'ri-hint',
  'rl-group-name-word',
  'room-row-toggle',
  'sca',
  'set-note',
  'sk-plan',
  'sk-progress',
  'sk-sheet',
  'strim',
  'week-gate',
  'wk-changes',
  'wk-day-floating',
  'wkr-drillin',
  'wkr-rollup',
]);

function srcDir(): string {
  // The same walk readStyle does, so the test runs from the workspace or the monorepo root.
  let dir = process.cwd();
  for (let up = 0; up < 6; up += 1) {
    for (const candidate of [join(dir, 'src', 'main.tsx'), join(dir, 'apps/cadence-web/src/main.tsx')]) {
      try {
        statSync(candidate);
        return join(candidate, '..');
      } catch {
        /* keep walking */
      }
    }
    dir = join(dir, '..');
  }
  throw new Error(`could not find src/main.tsx from ${process.cwd()}`);
}

function* filesUnder(dir: string, ext: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* filesUnder(p, ext);
    else if (name.endsWith(ext) && !name.includes('.test.')) yield p;
  }
}

describe('class coverage', () => {
  it('every static className a component names is defined in a loaded stylesheet', () => {
    const root = srcDir();
    // Every stylesheet under src — the ones main.tsx loads and the ones a screen imports itself.
    const css = Array.from(filesUnder(root, '.css'), (f) => readFileSync(f, 'utf-8')).join('\n');
    const defined = new Set(Array.from(css.matchAll(/\.([a-zA-Z][\w-]*)/g), (m) => m[1]!));

    const missing = new Map<string, string>();
    for (const file of filesUnder(root, '.tsx')) {
      const rel = relative(root, file);
      if (rel.startsWith('features/dev/')) continue; // dev previews style themselves inline
      const text = readFileSync(file, 'utf-8');
      for (const m of text.matchAll(/className=["']([^"']+)["']/g)) {
        for (const token of m[1]!.split(/\s+/)) {
          if (token && !defined.has(token) && !BARE_ROOTS.has(token) && !missing.has(token)) missing.set(token, rel);
        }
      }
    }
    expect(
      Array.from(missing, ([token, file]) => `${token} (${file})`),
      'a class a component names has no rule in any stylesheet under src — a block was lost',
    ).toEqual([]);
  });
});
