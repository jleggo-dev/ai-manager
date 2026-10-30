import { describe, expect, it } from 'vitest';
import { buildSinglePrompt, partsToLookups, splitMealParts, stripAmount } from './eval-food-check-single.ts';
import type { FoodCheckCase } from './eval-food-check-cases.ts';

describe('splitMealParts — separators a person actually types', () => {
  it.each([
    ['150ml 2% mulk', ['150ml 2% mulk']],
    ['1.5 c milk\n2 shots espresso', ['1.5 c milk', '2 shots espresso']],
    ['coffee with cream', ['coffee', 'cream']],
    ['eggs, toast and butter', ['eggs', 'toast', 'butter']],
    ['1 cup coconut milk beverage, unsweetened', ['1 cup coconut milk beverage', 'unsweetened']],
    ['Starbucks venti latte', ['Starbucks venti latte']],
    ['a sandwich', ['a sandwich']],
  ])('%j → %j', (text, parts) => {
    expect(splitMealParts(text)).toEqual(parts);
  });

  it('dictated prose with no separators stays one part (the second round catches it)', () => {
    const parts = splitMealParts('Quarter cup of frozen blueberries quarter cup of frozen strawberries');
    expect(parts).toHaveLength(1);
  });
});

describe('stripAmount — the amount comes off, the food stays', () => {
  it.each([
    ['150ml 2% mulk', '2% mulk', '150ml'],
    ['2 tbsp powdered peanut butter', 'powdered peanut butter', '2 tbsp'],
    ['1/2 cup uncooked white rice', 'uncooked white rice', '1/2 cup'],
    ['a handful of almonds', 'almonds', 'a handful'],
    ['a banana', 'banana', null],
    ['1 medium baked sweet potato', 'baked sweet potato', '1 medium'],
    ['6 oz grilled chicken breast', 'grilled chicken breast', '6 oz'],
    ['Starbucks venti latte', 'Starbucks venti latte', null],
    ["siggi's creamy skyr plain", "siggi's creamy skyr plain", null],
    ['2 Roma tomatoes', 'Roma tomatoes', '2'],
  ])('%j → q %j, measure %j', (part, q, measure) => {
    expect(stripAmount(part)).toEqual({ q, measure });
  });

  it('never strips a part down to nothing', () => {
    expect(stripAmount('2 large')).toEqual({ q: '2 large', measure: null });
  });
});

describe('partsToLookups', () => {
  it('one lookup per distinct part, amount as the measure', () => {
    expect(partsToLookups('1.5 c milk\n2 shots espresso')).toEqual([
      { q: 'milk', measure: '1.5 c', brand: null },
      { q: 'espresso', measure: '2 shots', brand: null },
    ]);
  });
  it('the same food twice is looked up once', () => {
    expect(partsToLookups('milk, milk')).toHaveLength(1);
  });
});

describe('buildSinglePrompt — the last call cannot ask for more', () => {
  const c: FoodCheckCase = { id: 'x', kind: 'real', meal: 'lunch', text: 'eggs', kcal: 1, protein_g: 1, why: '' };
  it('offers lookups on the first call only', () => {
    expect(buildSinglePrompt(c, [], false)).toContain('"lookups"');
    const last = buildSinglePrompt(c, [], true);
    expect(last).not.toContain('"lookups"');
    expect(last).toContain('last reply');
  });
});
