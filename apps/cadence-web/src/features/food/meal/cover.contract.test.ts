/**
 * The layout half of a bug jsdom cannot see, in two parts.
 *
 * 1. A surface that ASKS a question — the serving sheet, opened by a › food or by a scan — was
 *    rendered in normal flow after the draft strip. Every component assertion passed (it was in
 *    the document, its button worked) while on a phone it sat 394px below the bottom edge, so the
 *    tap read as a dead button (owner, on device, 2026-09-06).
 * 2. Chasing that turned up why the panel was tall enough to hide it: this stylesheet's own
 *    header comment contained the glob `.fa-*` followed by `/`, which ENDS a CSS comment. The
 *    prose after it became a selector that swallowed the `.ms` rule's whole block, so the meal
 *    screen was never `display: flex` and never fitted its host — for as long as the file has
 *    existed. Nothing in the suite could notice: jsdom does no layout, vitest runs `css: false`,
 *    and CSS is outside the repo's prettier scope.
 *
 * So this file reads the stylesheet as a browser does — parse it, then check both what the rules
 * say and that none of them went missing on the way in.
 */
import { describe, expect, it } from 'vitest';
import { parseStylesheet, readStyle } from '../../../test/css.ts';

const SOURCE = readStyle('src/styles/meal-screen.css');
const { rules, declared } = parseStylesheet(SOURCE);

function ruleFor(selector: string): CSSStyleDeclaration {
  const found = rules.get(selector);
  expect(found, `${selector} is declared in meal-screen.css but the parser never saw it`).toBeTruthy();
  return found!;
}

describe('meal-screen.css survives its own comments', () => {
  it('every selector the file declares reaches the parser', () => {
    // The same guard styles/stylesheets.contract.test.ts runs over every sheet, kept here too
    // because THIS file is where it bit: it names the rule, next to the rules that depend on it.
    expect(declared.length).toBeGreaterThan(40);
    expect(
      declared.filter((selector) => !rules.has(selector)),
      'these rules were swallowed by a comment that closed early',
    ).toEqual([]);
  });
});

describe('.ms — the meal screen fits its host', () => {
  it('is a flex column that fills and clips inside itself', () => {
    // Both hosts (the capture sheet, the Food tab) are flex columns with a real height. Without
    // these the column grows past them: the strip carrying "Done · back to breakfast" lands
    // off-screen, and on the Food tab — whose .app is overflow:hidden — the overflow is just gone.
    const ms = ruleFor('.ms');
    expect(ms.display).toBe('flex');
    expect(ms.flexDirection).toBe('column');
    expect(ms.flexGrow || ms.flex).toBeTruthy();
    expect(ms.minHeight).toBe('0px');
  });

  it('lets the panel scroll rather than the sheet', () => {
    expect(ruleFor('.ms-panel').minHeight).toBe('0px');
    expect(ruleFor('.ms-panel-scroll').overflowY).toBe('auto');
    // Without this the scroller cannot shrink, so a short sheet pushes the strip over the field.
    expect(ruleFor('.ms-panel-scroll').minHeight).toBe('0px');
  });

  it('keeps the search field out of the shrinking, and gives a composing sheet its height', () => {
    // `flex: none` is what stops the field donating its height to its siblings when the keyboard
    // shortens the sheet — it went to a 29px sliver on device before this (2026-09-06).
    // jsdom does not expand the `flex` shorthand, so read what the file declares.
    expect(SOURCE).toMatch(/\.ms-panel-field\s*\{[^}]*flex:\s*none/);
    // And the sheet hosting the panel gets the compose height styles.css grants typing surfaces.
    expect(SOURCE).toMatch(/\.sheet:has\(\.ms-panel\)\s*\{[^}]*max-height/);
  });

  it('the add panel’s cart floats over the list rather than taking its height', () => {
    // Canvas B2 draws it absolute at the bottom with the rows scrolling underneath. As a flex
    // sibling it took 108px off an already short sheet — one row left to pick from on a small
    // phone with the keyboard up (owner, 2026-09-06: "it should work on any phone").
    expect(ruleFor('.ms-panel > .ms-strip').position).toBe('absolute');
    expect(ruleFor('.ms-panel').position).toBe('relative');
    // …and the list pads itself so the last row can clear the cart instead of hiding under it.
    expect(SOURCE).toMatch(/\.ms-panel:has\(>\s*\.ms-strip\)\s+\.ms-panel-scroll\s*\{[^}]*padding-bottom/);
    // Only the add panel's. The scanner's and the serving sheet's stay in flow.
    expect(rules.get('.ms-strip')?.position || 'static').not.toBe('absolute');
  });
});

describe('.ms-cover — the surface that asks is drawn OVER, never after', () => {
  it('is out of flow and fills the screen', () => {
    // In flow it inherits the scroll position of whatever it was appended to — which is exactly
    // how it ended up somewhere no one could see.
    const cover = ruleFor('.ms-cover');
    expect(cover.position).toBe('fixed');
    expect(cover.inset || cover.top).toBeTruthy();
  });

  it('sits above the sheet it covers', () => {
    // .sheet is 51 and .ms-sheet-backdrop is 40 (styles.css / this file). Anything lower and the
    // cover renders behind the surface it replaces — invisible by a different route.
    const z = Number(ruleFor('.ms-cover').zIndex);
    expect(z).toBeGreaterThan(51);
    expect(Number(ruleFor('.ms-sheet-backdrop').zIndex)).toBeLessThan(z);
  });

  it('is opaque, and scrolls itself', () => {
    // Opaque: the panel behind it stays mounted (that is what keeps the search field's focus),
    // so a transparent cover would show two stacked surfaces at once.
    const cover = ruleFor('.ms-cover');
    expect(cover.background || cover.backgroundColor).toBeTruthy();
    expect(cover.background || cover.backgroundColor).not.toMatch(/transparent|none/);
    // A serving sheet plus the strip is taller than a phone; without this it clips instead.
    expect(cover.overflowY).toBe('auto');
  });
});
