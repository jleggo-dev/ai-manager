/**
 * The CSS half of "holding a disc selects the whole page" (owner, on device, 2026-11-01).
 *
 * A hold fires with the finger still down and opens the hold menu. iOS runs its own
 * text-selection long press a moment later on whatever is under that finger NOW — the scrim, or
 * the menu itself. Both were selectable, so the page went blue with the Copy / Share menu over
 * the sheet. jsdom does no selection gestures and vitest runs `css: false`, so this reads the
 * stylesheets that ship: the disc, the scrim and the hold menu must refuse selection and the
 * callout. (lib/holdSelection.ts is the JS half.)
 */
import { describe, expect, it } from 'vitest';
import { parseStylesheet, readStyle } from '../../../test/css.ts';

// Read and parsed once: styles.css is thousands of lines and jsdom's parser is slow.
const SHEETS = Object.fromEntries(
  ['src/styles.css', 'src/styles/hold-menu.css'].map((path) => {
    const css = readStyle(path);
    return [path, { css, rules: parseStylesheet(css).rules }];
  }),
) as Record<'src/styles.css' | 'src/styles/hold-menu.css', { css: string; rules: Map<string, CSSStyleDeclaration> }>;

/** The parsed rule, plus its source text — jsdom's parser drops -webkit-touch-callout. */
function rule(path: keyof typeof SHEETS, selector: string): { style: CSSStyleDeclaration; source: string } {
  const { css, rules } = SHEETS[path];
  const style = rules.get(selector);
  expect(style, `${selector} never reached the parser in ${path}`).toBeTruthy();
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const source = new RegExp(`^${escaped} \\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? '';
  return { style: style!, source };
}

describe('nothing a hold lands on is selectable', () => {
  it.each([
    ['src/styles/hold-menu.css', '.trail-node', 'the held disc'],
    ['src/styles.css', '.sheet-scrim', 'the scrim the hold opens under the finger'],
    ['src/styles/hold-menu.css', '.hm-hold', 'the hold menu sheet'],
  ] as const)('%s %s — %s', (path, selector, _what) => {
    const { style, source } = rule(path, selector);
    expect(style.getPropertyValue('user-select')).toBe('none');
    expect(style.getPropertyValue('-webkit-user-select')).toBe('none');
    expect(source).toMatch(/-webkit-touch-callout:\s*none/);
  });

  it('the preview sheet (.hm, opened by a tap) keeps its words selectable', () => {
    const { style } = rule('src/styles/hold-menu.css', '.hm');
    expect(style.getPropertyValue('user-select')).toBe('');
  });
});
