/**
 * Every rule in every stylesheet has to survive the parse.
 *
 * A CSS comment ends at the first star-slash, and a selector glob written in prose — a `.fa-`
 * wildcard followed by a slash — is one. (This file learned it the hard way: the sentence you
 * are reading closed its own JSDoc block on the first attempt.) When it happens the comment
 * ends early, the prose after it becomes a
 * selector, and it swallows the entire rule that follows. The browser reports nothing. Nothing in
 * the suite can see it either: jsdom does no layout, vitest runs `css: false`, and CSS sits
 * outside the repo's prettier scope, whose CssSyntaxError was the only complaint anyone ever got.
 *
 * That is how `.ms` — `display: flex` on the meal screen — was silently absent from
 * meal-screen.css for as long as the file existed, which is why the meal screen grew past its
 * host instead of scrolling inside it (owner, on device, 2026-09-06). This is the cheap check
 * that no stylesheet is quietly missing a rule again.
 */
import { describe, expect, it } from 'vitest';
import { parseStylesheet, readStyle } from '../test/css.ts';

/** Every stylesheet main.tsx loads, in load order. */
const SHEETS = [
  'src/styles.css',
  'src/styles/coach.css',
  'src/styles/onboarding.css',
  'src/styles/gate.css',
  'src/styles/food-capture.css',
  'src/styles/bracket.css',
  'src/styles/shelf.css',
  'src/styles/meal-screen.css',
  'src/styles/sweep.css',
  'src/styles/skeleton.css',
  'src/styles/repertoire-item.css',
  'src/styles/seed-review.css',
  'src/styles/repertoire-list.css',
  'src/styles/settings-room.css',
  'src/styles/settings-activities.css',
];

describe('stylesheets', () => {
  it.each(SHEETS)('%s — every rule it declares reaches the parser', (path) => {
    const { rules, declared } = parseStylesheet(readStyle(path));
    expect(declared.length, `${path} declares no rules — is the path right?`).toBeGreaterThan(0);
    const missing = declared.filter((selector) => !rules.has(selector));
    expect(missing, `swallowed by a comment that closed early in ${path}`).toEqual([]);
  });
});
