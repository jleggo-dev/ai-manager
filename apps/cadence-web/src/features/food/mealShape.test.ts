import { describe, expect, it } from 'vitest';
import { isQuantified, looksLikeMultiItemMeal, mealSegments } from './mealShape.ts';

/**
 * The split that decides which question the user gets asked. The first case is the owner's own
 * smoothie, verbatim — five quantified ingredients that were funnelled into a single-food
 * "select the serving size" question, which the message had already answered.
 */
describe('looksLikeMultiItemMeal', () => {
  it("recognizes the owner's smoothie as a meal", () => {
    expect(
      looksLikeMultiItemMeal(
        '1 cup frozen strawberries, 1/3 cup greek vanilla yogurt, 2/3 c skyr, 1 scoop protein powder, 1/3 cup oragne juice',
      ),
    ).toBe(true);
  });

  it('keeps a single food with a portion on the resolver path', () => {
    expect(looksLikeMultiItemMeal('nonfat greek yogurt, 170g')).toBe(false);
    expect(looksLikeMultiItemMeal('170g nonfat greek yogurt')).toBe(false);
  });

  it('keeps a bare dish name on the resolver path', () => {
    expect(looksLikeMultiItemMeal('turkey chili bowl')).toBe(false);
    expect(looksLikeMultiItemMeal('strawberry smoothie')).toBe(false);
  });

  it('reads "and"-joined and newline-joined ingredients', () => {
    expect(looksLikeMultiItemMeal('2 eggs and 2 slices of toast')).toBe(true);
    expect(looksLikeMultiItemMeal('1 cup oats\n1 scoop whey\nhandful of blueberries')).toBe(true);
  });

  it('reads unicode fractions the way people type them', () => {
    expect(looksLikeMultiItemMeal('½ cup oats, ⅓ cup milk')).toBe(true);
  });

  it('two unquantified foods stay with the resolver — no amounts, nothing to itemize', () => {
    expect(looksLikeMultiItemMeal('coffee and a croissant')).toBe(false);
  });
});

describe('segments and quantities', () => {
  it('splits on the separators people actually use', () => {
    expect(mealSegments('a, b; c + d and e with f')).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('counts measures as quantities even without digits', () => {
    expect(isQuantified('a scoop of whey')).toBe(true);
    expect(isQuantified('handful of almonds')).toBe(true);
    expect(isQuantified('black coffee')).toBe(false);
  });
});
