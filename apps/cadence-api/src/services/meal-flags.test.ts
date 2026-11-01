import { describe, expect, it } from 'vitest';
import { mealFlags } from './meal-flags.ts';

describe('mealFlags — named drinks only, nothing inferred', () => {
  it.each([
    ['Starbucks venti latte', { caffeine: true }],
    ['2 shots espresso', { caffeine: true }],
    ['a flat white with oat milk', { caffeine: true }],
    ['a pint of IPA', { alcohol: true }],
    ['glass of red wine with dinner', { alcohol: true }],
    ['espresso martini', { caffeine: true }],
    ['2 eggs on toast', {}],
    ['decaf', {}],
    ['ginger tea', {}],
    ['wine gums', { alcohol: true }],
    ['a banana', {}],
  ])('%j → %j', (text, flags) => {
    expect(mealFlags(text)).toEqual(flags);
  });
});
