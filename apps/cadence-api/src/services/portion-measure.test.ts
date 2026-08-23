import { describe, it, expect } from 'vitest';
import { checkPlausible, parseLeadingQuantity, parseMeasure } from './portion-measure.ts';

/**
 * Reading a measure, and refusing an impossible answer about one.
 *
 * The cases are the owner's own recipe, because that is the bar: "1/4 cup", "1 tbsp chopped
 * rosemary", "1/2 tsp xanthan gum", "3 shallots", "500 ml", "680g". Every one of those has to come
 * out of a chat message correctly or the arithmetic downstream is wrong in a way nobody sees.
 */

describe('quantities as people write them', () => {
  const cases: Array<[string, number]> = [
    ['1/4 cup', 0.25],
    ['1/2 tsp salt', 0.5],
    ['1 1/2 cups', 1.5],
    ['½ tsp', 0.5],
    ['1½ cups', 1.5],
    ['3 shallots', 3],
    ['0.5 cup', 0.5],
    ['680g button mushrooms', 680],
    ['a tbsp of pepper', 1],
    ['cup of milk', 1],
  ];
  for (const [text, qty] of cases) {
    it(`reads "${text}" as ${qty}`, () => {
      expect(parseLeadingQuantity(text).qty).toBeCloseTo(qty, 3);
    });
  }
});

describe('the recipe from the test case, ingredient by ingredient', () => {
  it('680g button mushrooms is already a mass — nothing to look up', () => {
    const m = parseMeasure('680g button mushrooms');
    expect(m.kind).toBe('mass');
    expect(m.grams).toBeCloseTo(680, 1);
  });

  it('500 ml evaporated milk is a volume needing a density', () => {
    const m = parseMeasure('500 ml evaporated milk');
    expect(m.kind).toBe('volume');
    expect(m.ml).toBeCloseTo(500, 1);
    expect(m.grams).toBeNull();
  });

  it('1 tbsp black pepper is a volume of a solid', () => {
    const m = parseMeasure('1 tbsp black pepper');
    expect(m.kind).toBe('volume');
    expect(m.ml).toBeCloseTo(14.79, 1);
  });

  it('1/2 tsp xanthan gum keeps its fraction', () => {
    const m = parseMeasure('1/2 tsp xanthan gum');
    expect(m.kind).toBe('volume');
    expect(m.ml).toBeCloseTo(2.46, 2);
    expect(m.label).toBe('1/2 tsp');
  });

  it('3 shallots is a count, and remembers what is being counted', () => {
    const m = parseMeasure('3 shallots');
    expect(m.kind).toBe('count');
    expect(m.qty).toBe(3);
    expect(m.countOf).toBe('shallots');
    expect(m.label).toBe('3 shallots');
  });

  it('15 pieces of mixed dried mushroom counts pieces', () => {
    const m = parseMeasure('15 pieces of mixed dried mushroom');
    expect(m.kind).toBe('count');
    expect(m.qty).toBe(15);
    expect(m.countOf).toContain('pieces');
  });

  it('3 cups is the yield, read as a volume', () => {
    const m = parseMeasure('3 cups');
    expect(m.kind).toBe('volume');
    expect(m.ml).toBeCloseTo(709.76, 1);
  });

  it('handles ounces, which is how USDA had the shallots', () => {
    const m = parseMeasure('2 oz');
    expect(m.kind).toBe('mass');
    expect(m.grams).toBeCloseTo(56.7, 1);
  });

  it('labels a fraction the way a person wrote it, for the servings row', () => {
    expect(parseMeasure('1/4 cup').label).toBe('1/4 cup');
    expect(parseMeasure('1 1/2 cups').label).toBe('1 1/2 cups');
  });

  it('treats an unknown unit as a count rather than guessing', () => {
    const m = parseMeasure('2 handfuls of spinach');
    expect(m.kind).toBe('count');
    expect(m.countOf).toContain('handful');
  });
});

describe('the density guard catches unit errors, not wrong-but-possible answers', () => {
  const quarterCup = parseMeasure('1/4 cup');

  it('accepts a believable weight for a quarter cup of chopped shallots', () => {
    expect(checkPlausible(quarterCup, 40).ok).toBe(true);
  });

  it('accepts dried mushrooms, which are genuinely almost weightless', () => {
    // The owner's own label: 15 pieces = 15 g, and 15 pieces is a loose handful.
    expect(checkPlausible(parseMeasure('1 cup'), 15).ok).toBe(true);
  });

  it('accepts salt, which is genuinely dense', () => {
    expect(checkPlausible(parseMeasure('1 tsp'), 6).ok).toBe(true);
  });

  /** The failure that actually happens: an order-of-magnitude slip or a swapped unit. */
  it('rejects a quarter cup weighing more than a kilo', () => {
    const v = checkPlausible(quarterCup, 5000);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('g/ml');
  });

  it('rejects a tablespoon weighing a gram of a gram', () => {
    expect(checkPlausible(parseMeasure('1 tbsp'), 0.01).ok).toBe(false);
  });

  it('rejects zero and nonsense outright', () => {
    expect(checkPlausible(quarterCup, 0).ok).toBe(false);
    expect(checkPlausible(quarterCup, Number.NaN).ok).toBe(false);
    expect(checkPlausible(quarterCup, -5).ok).toBe(false);
  });

  it('guards a count on per-item weight, not on the total', () => {
    // 3 shallots at 25 g each is fine; 3 "shallots" at 20 kg each is not.
    expect(checkPlausible(parseMeasure('3 shallots'), 75).ok).toBe(true);
    expect(checkPlausible(parseMeasure('3 shallots'), 60_000).ok).toBe(false);
  });

  it('has no density opinion about a count, because there is no volume to have one about', () => {
    expect(checkPlausible(parseMeasure('2 green onions'), 30).ok).toBe(true);
  });
});
