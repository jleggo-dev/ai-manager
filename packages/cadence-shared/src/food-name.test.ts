import { describe, expect, it } from 'vitest';
import { brandedFoodName } from './food-name.ts';

describe('brandedFoodName — the brand goes in front unless the name already says it', () => {
  it.each([
    // positives: the brand is added
    ['Lemon-lime', 'Gatorade', 'Gatorade Lemon-lime'],
    ['Greek Yogurt, Plain', 'Fage', 'Fage Greek Yogurt, Plain'],
    ['Oat Milk', '  Oatly ', 'Oatly Oat Milk'],
    // near-misses: the brand is a prefix of a word in the name, not the word — still added
    ['Oatlyish Drink', 'Oatly', 'Oatly Oatlyish Drink'],
    // already named: left alone
    ['Gatorade Lemon-lime', 'Gatorade', 'Gatorade Lemon-lime'],
    ['gatorade lemon-lime', 'Gatorade', 'gatorade lemon-lime'],
    ['Lemon-lime (Gatorade)', 'Gatorade', 'Lemon-lime (Gatorade)'],
    ['Starbucks Caffè Latte', 'Starbucks', 'Starbucks Caffè Latte'],
    ["Ben & Jerry's Half Baked", "Ben & Jerry's", "Ben & Jerry's Half Baked"],
    ['Café Bustelo Espresso', 'Cafe Bustelo', 'Café Bustelo Espresso'],
    // no brand: the name as it is
    ['Banana, raw', null, 'Banana, raw'],
    ['Banana, raw', undefined, 'Banana, raw'],
    ['Banana, raw', '', 'Banana, raw'],
    ['Banana, raw', '   ', 'Banana, raw'],
  ])('%s + %s → %s', (name, brand, want) => {
    expect(brandedFoodName(name, brand)).toBe(want);
  });
});
