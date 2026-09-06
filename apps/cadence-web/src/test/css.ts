/**
 * Reading the app's real stylesheets from a test.
 *
 * jsdom does no layout and vitest runs `css: false`, so a stylesheet is invisible to the suite —
 * which is how `.ms` sat in meal-screen.css for months without ever applying (its own header
 * comment closed early on a glob and swallowed the rule). These two helpers are how a test looks
 * at what actually ships: read the file, and parse it the way a browser does.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Walk up from the run's cwd — vitest's root is the workspace, npm's may be the monorepo.
 *  (`?raw` would be tidier, but vitest runs `css: false` and hands back an empty string.) */
export function readStyle(relPath: string): string {
  let dir = process.cwd();
  for (let up = 0; up < 6; up += 1) {
    for (const candidate of [resolve(dir, relPath), resolve(dir, 'apps/cadence-web', relPath)]) {
      if (existsSync(candidate)) return readFileSync(candidate, 'utf-8');
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not find ${relPath} from ${process.cwd()}`);
}

export interface ParsedSheet {
  /** Every selector the parser actually saw, split on commas — the map's keys are the contract. */
  rules: Map<string, CSSStyleDeclaration>;
  /** Every selector the FILE declares at the top level, read as text. */
  declared: string[];
}

/** Parse a stylesheet as the browser does, and separately read what the file claims to declare. */
export function parseStylesheet(css: string): ParsedSheet {
  const el = document.createElement('style');
  el.textContent = css;
  document.head.appendChild(el);
  const rules = new Map<string, CSSStyleDeclaration>();
  for (const rule of Array.from(el.sheet?.cssRules ?? [])) {
    const styleRule = rule as CSSStyleRule;
    if (typeof styleRule.selectorText !== 'string') continue;
    for (const one of styleRule.selectorText.split(',')) rules.set(one.trim(), styleRule.style);
  }
  el.remove();

  // Comments stripped exactly as a parser strips them, so a comment that closes EARLY leaves its
  // prose behind and the rule it ate goes missing from `rules` — the mismatch is the failure.
  const declared = css
    .replace(/\/\*[\s\S]*?\*\//g, '\n')
    .split('\n')
    .filter((line) => /^\S[^{}]*\{\s*$/.test(line) && !line.startsWith('@'))
    .map((line) => line.replace(/\{\s*$/, '').trim());

  return { rules, declared };
}
