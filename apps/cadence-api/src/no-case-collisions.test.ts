/**
 * No two source files may differ only by case — a repo-wide guard, not a style rule.
 *
 * macOS and Windows have case-INSENSITIVE filesystems; Linux and CI do not. A pair like
 * `mealItemSheet.ts` beside `MealItemSheet.tsx` therefore behaves differently depending on where
 * it is compiled, and the local failure is silent in the worst possible way: TypeScript builds its
 * program from the include glob, collapses the two paths to one, and DROPS one of the files. It
 * does not warn. `tsc --noEmit` passes with a whole component unchecked — caught 2026-08-23 only
 * because a deliberately broken line in a new component produced no error at all.
 *
 * Everything downstream of that inherits the hole: a wrong prop type, a bad import, a missing
 * field — none of it is checked in a file the compiler never opened.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('source files', () => {
  it('never differ only by case', () => {
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);

    const byLower = new Map<string, string[]>();
    for (const file of tracked) {
      const key = file.toLowerCase();
      byLower.set(key, [...(byLower.get(key) ?? []), file]);
    }

    // A collision is two DIFFERENT paths sharing one lowercased path. It also catches the exact-
    // duplicate case a case-insensitive checkout can produce.
    const collisions = [...byLower.values()].filter((paths) => new Set(paths).size > 1);
    expect(collisions).toEqual([]);
  });

  it('never collide once the extension is dropped, within a directory', () => {
    // The subtler half, and the one that actually bit: `foo.ts` and `Foo.tsx` are distinct paths,
    // so the check above passes — but they are the SAME module specifier to a case-insensitive
    // resolver, and TypeScript keeps only one of them.
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
      .split('\0')
      .filter((f: string) => /\.(ts|tsx|mts|cts|js|jsx)$/.test(f));

    const byModule = new Map<string, string[]>();
    for (const file of tracked) {
      const key = file.replace(/\.(ts|tsx|mts|cts|js|jsx)$/, '').toLowerCase();
      byModule.set(key, [...(byModule.get(key) ?? []), file]);
    }

    const collisions = [...byModule.values()]
      .filter((paths) => paths.length > 1)
      // A real `.ts` + `.d.ts` or `.js` + `.d.ts` pair for the same module is normal and fine.
      .filter((paths) => new Set(paths.map((p) => (p.split('/').pop() ?? p).toLowerCase())).size > 1);

    expect(collisions).toEqual([]);
  });
});
