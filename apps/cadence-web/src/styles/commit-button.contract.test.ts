/**
 * The commit green lives in one place.
 *
 * Owner ruling 2026-11-02: orange opens a door, green commits. Before it, ten screens each drew
 * their own green button — the same colours hand-copied, with corners from 12 to 16px, three edge
 * depths and two weights — and nothing kept a new one from adding an eleventh. These checks do:
 * the green's raw values appear only where the --commit-* tokens are declared, and the sheet that
 * draws the button loads last, so no older rule of the same weight can repaint it.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readStyle } from '../test/css.ts';

const RAW_GREEN = /oklch\(\s*(60% 0\.1 152|52% 0\.09 152|39% 0\.08 152)\s*\)/g;

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return name.endsWith('.css') ? [path] : [];
  });
}

function srcDir(): string {
  // readStyle resolves from the workspace or the monorepo root; find src the same way.
  for (const base of [process.cwd(), join(process.cwd(), 'apps/cadence-web')]) {
    if (existsSync(join(base, 'src/styles.css'))) return join(base, 'src');
  }
  throw new Error('could not find apps/cadence-web/src');
}

describe('the commit green', () => {
  it('is declared once, as tokens, and never hand-copied into a stylesheet', () => {
    const src = srcDir();
    const offenders: string[] = [];
    for (const file of cssFiles(src)) {
      readStyle(relative(join(src, '..'), file))
        .split('\n')
        .forEach((line, i) => {
          if (!line.match(RAW_GREEN)) return;
          if (/^\s*--commit-(top|bottom|edge):/.test(line)) return;
          offenders.push(`${relative(src, file)}:${i + 1}  ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it('declares all three tokens in styles.css', () => {
    const root = readStyle('src/styles.css');
    for (const token of ['--commit-top', '--commit-bottom', '--commit-edge']) {
      expect(root).toContain(`${token}:`);
    }
  });

  it('loads last, after every other stylesheet', () => {
    const imports = [...readStyle('src/main.tsx').matchAll(/^import '\.\/(styles[^']*\.css)';/gm)].map((m) => m[1]);
    expect(imports.at(-1)).toBe('styles/commit-button.css');
  });
});
