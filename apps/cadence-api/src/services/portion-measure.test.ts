import { describe, it, expect } from 'vitest';
import type { FoodServing } from '@cadence/shared';
import {
  checkPlausible,
  matchMeasure,
  MAX_SCALE_RATIO,
  parseLeadingQuantity,
  parseMeasure,
  scaleFromOwnMeasures,
} from './portion-measure.ts';

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

/**
 * A leading article ("a"/"an"/"the") is never part of the unit or the noun. Before this fix,
 * `parseMeasure('half an egg')` parsed the unit as "an" (found in neither MASS_G nor VOLUME_ML),
 * so the count noun for matching came out "an" instead of "egg" — a food's own "1 egg" serving
 * silently stopped matching a request as ordinary as "half an egg".
 */
describe('a leading article never becomes the unit or the noun', () => {
  it('"half an egg" reads its unit as egg, not an', () => {
    const m = parseMeasure('half an egg');
    expect(m.kind).toBe('count');
    expect(m.countOf).toBe('egg');
    expect(m.qty).toBe(0.5);
  });

  it('matchMeasure finds a food\'s own "1 egg" serving from "half an egg"', () => {
    const egg: FoodServing[] = [{ label: '1 egg', unit: 'egg', amount_g: 50 }];
    expect(matchMeasure({ servings: egg }, 'half an egg')?.amount_g).toBe(50);
  });

  it('"an ounce of cheese" reads as a mass, not a count of "an"', () => {
    const m = parseMeasure('an ounce of cheese');
    expect(m.kind).toBe('mass');
    expect(m.grams).toBeCloseTo(28.35, 1);
  });

  it('still handles phrasing where parseLeadingQuantity already consumed the article', () => {
    // "a tbsp" / "cup of milk" — no article left over for this fix to touch.
    expect(parseLeadingQuantity('a tbsp of pepper').qty).toBe(1);
    expect(parseMeasure('a tbsp of pepper').kind).toBe('volume');
  });
});

/**
 * `matchMeasure` moved here from `food-source-report.ts` (MP0c, to break a circular import with
 * `food-pricing-portion.ts` — see that file's header). Behaviour is unchanged; re-verified here as
 * the function's new home. `food-source-report.test.ts` covers it again through the re-export, so
 * a caller that only ever imports it from there never has to know it moved.
 */
describe('matchMeasure — the one true serving-matcher', () => {
  const servings: FoodServing[] = [
    { label: '1 tbsp chopped', unit: 'tbsp', amount_g: 10 },
    { label: '100 g', unit: 'g', amount_g: 100 },
  ];

  it('matches the unit word, not any substring of the label', () => {
    // MP0b's exact shape: the OLD recipe-path bug was `label.includes(unit)` — unbounded
    // containment — so a request for "g" matched "15ml (16g)" because the label's OWN gram
    // annotation happens to contain the letter "g", an entirely different unit from what the row
    // actually measures. Word-based comparison (parsing both sides) correctly refuses: the row's
    // OWN unit, reparsed from its label, is "ml", and "ml" is not "g".
    const mlOnly: FoodServing[] = [{ label: '15ml (16g)', unit: '15ml', amount_g: 16 }];
    expect(matchMeasure({ servings: mlOnly }, 'g')).toBeNull();
  });

  it('DOES match "g" against a row genuinely denominated in g — that is correct, not the bug', () => {
    // Whether the food's own gram row should ever be reached with a raw absolute quantity (e.g.
    // "680 g") is `portionFactor`'s job (the absolute-amount step runs BEFORE any servings match —
    // see food-pricing-portion.test.ts and portion-resolve.ts's own comment on the same guard).
    // matchMeasure itself is a context-free "does this food have a serving spelled this way", and
    // for a food whose serving genuinely IS "g", the honest answer is yes.
    const withHundredG: FoodServing[] = [{ label: '100 g', unit: 'g', amount_g: 100 }];
    expect(matchMeasure({ servings: withHundredG }, 'g')?.amount_g).toBe(100);
  });

  it('matches loosely on case and label noise', () => {
    expect(matchMeasure({ servings }, 'tbsp')?.amount_g).toBe(10);
    expect(matchMeasure({ servings }, '1 TBSP CHOPPED')?.amount_g).toBe(10);
  });

  it('never invents a measure the food does not have', () => {
    expect(matchMeasure({ servings }, 'cup')).toBeNull();
  });
});

/**
 * MP1: CNF prints household measures as raw "15 mL (16 g)" rows, not under the name "tbsp" — even
 * though Health Canada's own convention already IS 1 tbsp = 15 mL. This is what lets the pricing
 * path reach that data for the units people actually speak, using only what the food itself
 * reported. Cases and numbers verified against real production CNF rows (see the PR description).
 */
describe("scaleFromOwnMeasures — reading a nearby amount off the food's own line", () => {
  const rosemary: FoodServing[] = [
    { unit: '5ml', label: '5ml (1.2g)', amount_g: 1.2 },
    { unit: '15ml', label: '15ml (3.3g)', amount_g: 3.3 },
    { unit: 'g', label: '100 g', amount_g: 100 },
  ];

  it('answers "1 tbsp" (14.79 ml) from the food\'s own 15 ml row', () => {
    const g = scaleFromOwnMeasures(rosemary, 'volume', 14.7868);
    expect(g).not.toBeNull();
    expect(g!).toBeCloseTo(3.25, 1);
  });

  it('answers a bare "500 ml" by scaling the closest point, not the smallest one', () => {
    const evapMilk: FoodServing[] = [
      { unit: '15ml', label: '15ml (16g)', amount_g: 16 },
      { unit: '100ml', label: '100ml (106.5g)', amount_g: 106.5 },
      { unit: '250ml', label: '250ml (266.3g)', amount_g: 266.3 },
    ];
    // Scaling from the 15 ml row (the recipe path's old bug — see recipe-macros.test.ts) would
    // give (16/15)*500 ≈ 533.3; scaling from the correct, CLOSEST 250 ml row gives 532.6. Distinct
    // enough at 1 decimal to prove which point actually won.
    const g = scaleFromOwnMeasures(evapMilk, 'volume', 500);
    expect(g!).toBeCloseTo(532.6, 1);
  });

  it('refuses to scale a volume request against a food with no volume-kind points at all', () => {
    expect(scaleFromOwnMeasures([{ label: '100 g', unit: 'g', amount_g: 100 }], 'volume', 15)).toBeNull();
  });

  it('a mass request DOES scale off rosemary\'s own trivial "100 g" row — that is not a bug', () => {
    // Every CNF row carries a "100 g" fallback by construction, so a mass request always has at
    // least this one point: scaling 100 g by 50/100 is just 50 g, identical to the absolute path.
    // This is here so a future change to the ratio guard cannot quietly start refusing it.
    expect(scaleFromOwnMeasures(rosemary, 'mass', 50)).toBeCloseTo(50, 6);
  });

  it(`refuses when nothing reported is within ${MAX_SCALE_RATIO}× of what was asked (a cup from a tablespoon)`, () => {
    // The exact case matchMeasure's own 'cup' test guards: a food with only a tablespoon-sized
    // point must not have a cup (16× away) invented from it.
    const tbspOnly: FoodServing[] = [{ label: '1 tbsp chopped', unit: 'tbsp', amount_g: 10 }];
    expect(scaleFromOwnMeasures(tbspOnly, 'volume', 236.588)).toBeNull();
  });

  it('accepts right at the boundary and refuses just past it', () => {
    const point: FoodServing[] = [{ label: '10 ml', unit: 'ml', amount_g: 10 }];
    expect(scaleFromOwnMeasures(point, 'volume', 10 * MAX_SCALE_RATIO)).not.toBeNull();
    expect(scaleFromOwnMeasures(point, 'volume', 10 * MAX_SCALE_RATIO + 0.01)).toBeNull();
  });

  it('rejects a non-positive or non-finite amount outright', () => {
    expect(scaleFromOwnMeasures(rosemary, 'volume', 0)).toBeNull();
    expect(scaleFromOwnMeasures(rosemary, 'volume', -5)).toBeNull();
    expect(scaleFromOwnMeasures(rosemary, 'volume', Number.NaN)).toBeNull();
  });
});
