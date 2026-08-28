/**
 * A23 §1a — portion arithmetic for the food ledger. Pure: no DB, no AI, no env.
 *
 * The headline case is the round-trip invariant at the bottom: pinning an estimate and pricing
 * the same portion back out must return the same numbers. That is what makes a pinned food a
 * stable price instead of a second guess.
 *
 * The `real CNF rows` describe block further down uses actual production data (pulled 2026-08-28,
 * food_ids on file in the PR description) rather than hand-built fixtures, because the audit's own
 * numbers needed verifying against what is actually stored, not what it was assumed to be — see
 * the PR description for exactly what that verification found (one of the four claimed numbers,
 * salt's, did not reproduce against the only real "Salt, table" row, and that row's own
 * `default_serving` turned out to point at "1 dash", not "100 g").
 */
import { describe, it, expect } from 'vitest';
import type { Food, FoodNutrients } from '@cadence/shared';
import { absoluteAmount, nutrientsPerBase, portionFactor, priceFood } from './food-pricing-portion.ts';

/** Real CNF rows (source 'cnf'), shape verified against production 2026-08-28 — not hand-built. */
const SHALLOT_RAW: Food = {
  food_id: '69dc2ffd-e4ba-48f0-9893-004c49b8c145',
  owner_user_id: null,
  visibility: 'shared',
  name: 'Shallot, raw',
  brand: null,
  source: 'cnf',
  off_id: null,
  fdc_id: null,
  base_unit: 'g',
  macros_per_base: { kcal: 72, protein_g: 2.5, carbs_g: 16.8, fat_g: 0.1 },
  servings: [
    { unit: '15ml chopped', label: '15ml chopped (10.1g)', amount_g: 10.1 },
    { unit: '100ml chopped', label: '100ml chopped (67.6g)', amount_g: 67.6 },
    { unit: '125ml chopped', label: '125ml chopped (84.5g)', amount_g: 84.5 },
    { unit: '250ml chopped', label: '250ml chopped (172.4g)', amount_g: 172.4 },
    { unit: 'g', label: '100 g', amount_g: 100 },
  ],
  default_serving: 4,
  confidence: 1,
  photo_ref: null,
};

const ROSEMARY_DRIED: Food = {
  food_id: '023c8136-cbde-4be9-b196-7f22ef254ea8',
  owner_user_id: null,
  visibility: 'shared',
  name: 'Spices, rosemary, dried',
  brand: null,
  source: 'cnf',
  off_id: null,
  fdc_id: null,
  base_unit: 'g',
  macros_per_base: { kcal: 331, protein_g: 4.9, carbs_g: 64.1, fat_g: 15.2 },
  servings: [
    { unit: '5ml', label: '5ml (1.2g)', amount_g: 1.2 },
    { unit: '15ml', label: '15ml (3.3g)', amount_g: 3.3 },
    { unit: 'g', label: '100 g', amount_g: 100 },
  ],
  default_serving: 2,
  confidence: 1,
  photo_ref: null,
};

const SALT_TABLE: Food = {
  food_id: '3bdfbbdd-82c4-4e9a-9ba4-616e58da0a1c',
  owner_user_id: null,
  visibility: 'shared',
  name: 'Salt, table',
  brand: null,
  source: 'cnf',
  off_id: null,
  fdc_id: null,
  base_unit: 'g',
  macros_per_base: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, sodium_mg: 38758 },
  servings: [
    { unit: '1 dash', label: '1 dash (0.4g)', amount_g: 0.4 },
    { unit: '5ml', label: '5ml (6.1g)', amount_g: 6.1 },
    { unit: '15ml', label: '15ml (18.2g)', amount_g: 18.2 },
    { unit: '250ml', label: '250ml (308.5g)', amount_g: 308.5 },
    { unit: 'g', label: '100 g', amount_g: 100 },
  ],
  default_serving: 0,
  confidence: 1,
  photo_ref: null,
};

const EVAPORATED_MILK_WHOLE: Food = {
  food_id: 'f4b1c1a0-0000-0000-0000-000000000000',
  owner_user_id: null,
  visibility: 'shared',
  name: 'Milk, evaporated, whole, canned, undiluted, 7.8% M.F.',
  brand: null,
  source: 'cnf',
  off_id: null,
  fdc_id: null,
  base_unit: 'g',
  macros_per_base: { kcal: 134, protein_g: 6.8, carbs_g: 10, fat_g: 7.8 },
  servings: [
    { unit: '15ml', label: '15ml (16g)', amount_g: 16 },
    { unit: '100ml', label: '100ml (106.5g)', amount_g: 106.5 },
    { unit: '125ml', label: '125ml (133.1g)', amount_g: 133.1 },
    { unit: '250ml', label: '250ml (266.3g)', amount_g: 266.3 },
    { unit: 'g', label: '100 g', amount_g: 100 },
  ],
  default_serving: 4,
  confidence: 1,
  photo_ref: null,
};

type TestFood = Pick<Food, 'base_unit' | 'macros_per_base' | 'servings' | 'default_serving'>;

/** Greek yogurt: per-100 g nutrients, sold as a 170 g container. */
const YOGURT: TestFood = {
  base_unit: 'g',
  macros_per_base: { kcal: 59, protein_g: 10, calcium_mg: 110 },
  servings: [
    { label: '1 container (170g)', unit: 'container', amount_g: 170 },
    { label: '100 g', unit: 'g', amount_g: 100 },
  ],
  default_serving: 0,
};

/** A countable food: base is one egg. */
const EGG: TestFood = {
  base_unit: 'item',
  macros_per_base: { kcal: 70, protein_g: 6 },
  servings: [{ label: '1 egg', unit: 'egg', amount_g: 1 }],
  default_serving: 0,
};

describe('absoluteAmount', () => {
  it('converts mass and volume units to base units', () => {
    expect(absoluteAmount('g', 170)).toBe(170);
    expect(absoluteAmount('kg', 1.2)).toBeCloseTo(1200, 5);
    expect(absoluteAmount('oz', 2)).toBeCloseTo(56.699, 2);
    expect(absoluteAmount('ml', 250)).toBe(250);
    expect(absoluteAmount('L', 1)).toBe(1000);
  });

  it('leaves serving words alone so the food’s own servings win', () => {
    expect(absoluteAmount('bowl', 1)).toBeNull();
    expect(absoluteAmount('cup', 1)).toBeNull();
    expect(absoluteAmount('container', 1)).toBeNull();
    expect(absoluteAmount('slice', 2)).toBeNull();
  });

  it('needs a positive quantity and a unit', () => {
    expect(absoluteAmount('g', 0)).toBeNull();
    expect(absoluteAmount('g', undefined)).toBeNull();
    expect(absoluteAmount(undefined, 100)).toBeNull();
    expect(absoluteAmount('g', Number.NaN)).toBeNull();
  });
});

describe('portionFactor', () => {
  /**
   * The bug this module exists to prevent: "170 g" against a per-100 g food is 1.7 bases. Read as
   * a serving multiplier it would be 170 × a 170 g container — a 17,000 kcal breakfast.
   */
  it('treats an absolute mass as an amount, never as a serving multiplier', () => {
    const p = portionFactor(YOGURT, { qty: 170, unit: 'g', text: '170 g yogurt' });
    expect(p.factor).toBeCloseTo(1.7, 6);
    expect(p.serving_index).toBeNull();
    expect(priceFood(YOGURT, { qty: 170, unit: 'g' }).kcal).toBeCloseTo(100.3, 1);
  });

  it('agrees with itself whichever way the same portion is described', () => {
    const byMass = priceFood(YOGURT, { qty: 170, unit: 'g' });
    const bySer = priceFood(YOGURT, { qty: 1, unit: 'container' });
    expect(byMass.kcal).toBeCloseTo(bySer.kcal!, 1);
    expect(byMass.protein_g).toBeCloseTo(bySer.protein_g!, 1);
  });

  it('uses servings[] for serving-shaped units', () => {
    const p = portionFactor(YOGURT, { qty: 2, unit: 'container', text: '2 containers of yogurt' });
    expect(p.serving_index).toBe(0);
    expect(p.factor).toBeCloseTo(3.4, 6);
    expect(p.unit).toBe('container');
  });

  it('multiplies countable items by quantity', () => {
    expect(portionFactor(EGG, { qty: 3, text: '3 eggs' }).factor).toBe(3);
    expect(priceFood(EGG, { qty: 3, text: '3 eggs' })).toEqual({ kcal: 210, protein_g: 18 });
  });

  it('falls back to the default serving and quantity 1 when the parse gave nothing', () => {
    const p = portionFactor(YOGURT, {});
    expect(p.serving_index).toBe(0);
    expect(p.quantity).toBe(1);
    expect(p.factor).toBeCloseTo(1.7, 6);
  });

  it('a bare fractional quantity with no unit is still bounded — half of the default is fine', () => {
    const p = portionFactor(YOGURT, { qty: 0.5 });
    expect(p.unresolved).toBeUndefined();
    expect(p.factor).toBeCloseTo(0.85, 6); // half a 170 g container
  });

  /**
   * The gap a fail-first test on recipe-macros.ts caught while writing THIS PR: `!unitWord &&
   * !text.trim()` alone would treat `{qty: 3}` (unit and text both dropped, quantity meaningfully
   * NOT 1) exactly like `{}` — silently pricing 3 OF the food's unrelated default serving. That is
   * the identical shape to "3 shallots" landing on 3× a 100 g default; only the missing piece
   * differs (here the caller dropped the unit, there the resolver couldn't understand it). A
   * quantity greater than one, with nothing to say what it is three of, must ask, not guess.
   */
  it('a quantity greater than one with NO unit or text is unresolved, not 3× the default', () => {
    const p = portionFactor(YOGURT, { qty: 3 });
    expect(p.factor).not.toBe(5.1); // the old shape: 3 × the 170 g container
    expect(p.factor).toBe(0);
    expect(p.unresolved).toBe(true);
    expect(p.reason).toMatch(/no unit or description/);
  });

  /**
   * Found by the full suite while writing this PR (3 real failures in food-pricing.test.ts,
   * food-pricing-research.test.ts, nutrition-ledger.test.ts): a freshly-pinned one-off estimate
   * (`nutrientsPerBase` on an unnamed item — no `unit` given) gets ONE generic "1 serving" row.
   * Pricing it back out re-describes it by the item's actual NAME ("venti latte"), which correctly
   * does not match the word "serving" — but with only one row on the food, that mismatch must not
   * become unresolved: there is nothing else it could mean. This is the round-trip invariant this
   * file's header describes, for the specific case where the pin carried no separate unit at all.
   */
  it('a pinned one-off with a single generic serving prices back out by name, not by matching "serving"', () => {
    const pinnedSnack: TestFood = {
      base_unit: 'item',
      macros_per_base: { kcal: 200, protein_g: 5 },
      servings: [{ label: '1 serving', unit: 'serving', amount_g: 1 }],
      default_serving: 0,
    };
    const p = portionFactor(pinnedSnack, { qty: 1, text: '1  mystery snack' });
    expect(p.unresolved).toBeUndefined();
    expect(p.factor).toBe(1);
    expect(priceFood(pinnedSnack, { qty: 1, text: '1  mystery snack' })).toEqual({ kcal: 200, protein_g: 5 });
  });

  /**
   * The guard against over-applying the fix above: a MASS-based food's single named serving is an
   * arbitrary-sized convenience label (a can happens to be 400 g), not the food's own irreducible
   * unit — "bowl" silently becoming "can" because it is the only option on file would be the
   * shallots bug in miniature. Scoped to `base_unit === 'item'` specifically; see recipe-macros.ts's
   * matching case for the food this distinction protects.
   */
  it("does NOT extend the single-serving exception to a mass-based food's one named serving", () => {
    const cannedBeans: TestFood = {
      base_unit: 'g',
      macros_per_base: { kcal: 90, protein_g: 6 },
      servings: [{ label: '1 can (400g)', unit: 'can', amount_g: 400 }],
      default_serving: 0,
    };
    const p = portionFactor(cannedBeans, { qty: 1, unit: 'bowl' });
    expect(p.factor).not.toBeCloseTo(4, 1); // the old shape: 1 × the 400 g can
    expect(p.unresolved).toBe(true);
  });

  it('infers quantity from phrasing when qty is absent', () => {
    expect(portionFactor(EGG, { text: 'half an egg' }).quantity).toBe(0.5);
  });

  it('ignores junk quantities rather than zeroing the meal', () => {
    expect(portionFactor(EGG, { qty: -2, text: 'eggs' }).quantity).toBe(1);
    expect(portionFactor(EGG, { qty: Number.NaN, text: 'eggs' }).quantity).toBe(1);
  });

  it('never scales a food that carries no servings', () => {
    const empty: TestFood = { base_unit: 'item', macros_per_base: { kcal: 100 }, servings: [], default_serving: 0 };
    expect(portionFactor(empty, { qty: 2 }).factor).toBe(0);
    expect(priceFood(empty, { qty: 2 })).toEqual({});
  });
});

/**
 * FOOD-ENGINE.md §2.1's four mispricing cases, against real CNF rows. Each one FAILED on the code
 * this PR replaces — verified with a throwaway probe against these exact rows before any fix
 * landed (see the PR description). `default_serving` on every one of these real rows points at the
 * "100 g" (or, for salt, "1 dash") fallback — which is precisely how "not recognising a unit"
 * turned into "the food's 100 g default, multiplied by the quantity" (MP0a/MP0b's root cause).
 */
describe('the meal-prep scenario, against real CNF rows (MP0a, MP0b, MP1)', () => {
  it('500 ml evaporated milk no longer prices as 500 g (MP0a: ml treated as g on a g-based food)', () => {
    const p = portionFactor(EVAPORATED_MILK_WHOLE, { qty: 500, unit: 'ml', text: '500 ml evaporated milk' });
    // FAILS on pre-fix code: factor was exactly 5 (500 g). Correct is ~532.6 g, scaled from the
    // food's own 250 ml (266.3 g) row — density ~1.065 g/ml, Health Canada's own number.
    expect(p.factor).not.toBeCloseTo(5, 1);
    expect(p.factor).toBeCloseTo(5.326, 2);
    expect(p.unresolved).toBeUndefined();
    const kcal = priceFood(EVAPORATED_MILK_WHOLE, { qty: 500, unit: 'ml' }).kcal!;
    expect(kcal).not.toBeCloseTo(670, 0); // the old, wrong answer
    expect(kcal).toBeCloseTo(713.7, 0);
  });

  it('1 tbsp chopped rosemary no longer prices as the 100 g default (~30× over)', () => {
    const p = portionFactor(ROSEMARY_DRIED, { qty: 1, unit: 'tbsp', text: '1 tbsp chopped rosemary' });
    // FAILS on pre-fix code: serving_index was 2 (the "100 g" default), factor 1. Correct scales
    // from the food's own 15 ml (3.3 g) row — 1 tbsp ≈ 14.79 ml is 98.6% of it.
    expect(p.serving_index).toBeNull(); // derived, not a servings[] index — see Portion's docstring
    expect(p.factor).not.toBeCloseTo(1, 2);
    expect(p.factor).toBeCloseTo(0.0325, 3);
    const kcal = priceFood(ROSEMARY_DRIED, { qty: 1, unit: 'tbsp' }).kcal!;
    expect(kcal).not.toBeCloseTo(331, 0); // the old, wrong answer (100 g of a 331 kcal/100g spice)
    expect(kcal).toBeCloseTo(10.8, 0);
  });

  it('1/2 tsp salt no longer prices off the wrong default — it lands near a real half-teaspoon', () => {
    const p = portionFactor(SALT_TABLE, { qty: 0.5, unit: 'tsp', text: '1/2 tsp salt' });
    // Pre-fix code found no match for "tsp" and fell to servings[default_serving] — for this real
    // row that is index 0, "1 dash" (0.4 g), giving 0.2 g: an under-count as silent as the
    // over-counts above, from the identical root cause. Correct scales from the food's own 5 ml
    // (6.1 g) row — a real half teaspoon of table salt is close to 3 g.
    expect(p.factor).not.toBeCloseTo(0.002, 3); // the old, wrong answer
    expect(p.factor).toBeCloseTo(0.03, 2);
    expect(p.quantity).toBeCloseTo(3.0, 1);
  });

  it('3 shallots comes back UNRESOLVED, not 300 g — the food has no per-shallot count measure', () => {
    // The real "Shallot, raw" row's servings are ALL volume ("15/100/125/250 ml chopped") or the
    // 100 g default — never a per-item count. This is the case FOOD-ENGINE.md §2.2 exists for:
    // there is genuinely nothing to scale from, so the honest answer is a question, not a guess.
    const p = portionFactor(SHALLOT_RAW, { qty: 3, text: '3 shallots' });
    // FAILS on pre-fix code: factor was exactly 3 (300 g, the 100 g default × 3).
    expect(p.factor).not.toBe(3);
    expect(p.factor).toBe(0);
    expect(p.unresolved).toBe(true);
    expect(p.reason).toMatch(/no ".*" measure/);
    expect(priceFood(SHALLOT_RAW, { qty: 3, text: '3 shallots' })).toEqual({});
  });
});

describe('nutrientsPerBase (pinning a one-off estimate)', () => {
  it('pins an absolute-mass portion per 100 base units', () => {
    const pin = nutrientsPerBase({ kcal: 100, protein_g: 17 }, { qty: 170, unit: 'g' });
    expect(pin?.base_unit).toBe('g');
    expect(pin?.macros_per_base.kcal).toBeCloseTo(58.8, 1);
    // What they actually ate is the default serving, so the next log reproduces it.
    expect(pin?.servings[0]).toEqual({ label: '170 g', unit: 'g', amount_g: 170 });
    expect(pin?.default_serving).toBe(0);
  });

  it('pins a volume portion as ml', () => {
    expect(nutrientsPerBase({ kcal: 120 }, { qty: 500, unit: 'ml' })?.base_unit).toBe('ml');
  });

  it('pins a countable portion as one item, dividing out the quantity', () => {
    const pin = nutrientsPerBase({ kcal: 210, protein_g: 18 }, { qty: 3, unit: 'egg' });
    expect(pin?.base_unit).toBe('item');
    expect(pin?.macros_per_base).toEqual({ kcal: 70, protein_g: 6 });
    expect(pin?.servings).toEqual([{ label: '1 egg', unit: 'egg', amount_g: 1 }]);
  });

  it('labels a unitless portion a serving', () => {
    expect(nutrientsPerBase({ kcal: 250 }, { qty: 1 })?.servings[0]?.unit).toBe('serving');
  });

  it('returns null when there is nothing to pin', () => {
    expect(nutrientsPerBase({}, { qty: 1 })).toBeNull();
    expect(nutrientsPerBase({ kcal: 100 }, { qty: 0 })?.macros_per_base.kcal).toBe(100); // qty 0 → inferred 1
  });
});

/**
 * THE CONTRACT. Pin an estimate, then price the same portion back out of the pinned food: the
 * numbers must come back. If this ever fails, a user's parfait silently changes price the second
 * time they log it — which is the entire bug this project exists to fix.
 */
describe('round-trip: pin then price', () => {
  const cases: Array<{ name: string; est: FoodNutrients; portion: { qty?: number; unit?: string; text?: string } }> = [
    { name: 'a venti latte', est: { kcal: 250, protein_g: 12, fat_g: 9 }, portion: { qty: 1, unit: 'latte' } },
    { name: '3 eggs', est: { kcal: 210, protein_g: 18 }, portion: { qty: 3, unit: 'egg' } },
    { name: '170 g yogurt', est: { kcal: 100, protein_g: 17 }, portion: { qty: 170, unit: 'g' } },
    { name: '2 oz almonds', est: { kcal: 328, fat_g: 28 }, portion: { qty: 2, unit: 'oz' } },
    { name: '500 ml smoothie', est: { kcal: 320, carbs_g: 60 }, portion: { qty: 500, unit: 'ml' } },
    { name: 'a bowl of oatmeal', est: { kcal: 300, fiber_g: 8 }, portion: { qty: 1, unit: 'bowl' } },
    { name: 'half a bagel', est: { kcal: 140, carbs_g: 27 }, portion: { qty: 0.5, unit: 'bagel' } },
    { name: 'a parfait, no unit given', est: { kcal: 380, protein_g: 14 }, portion: { qty: 1 } },
  ];

  for (const c of cases) {
    it(`survives ${c.name}`, () => {
      const pin = nutrientsPerBase(c.est, c.portion);
      expect(pin).not.toBeNull();
      const priced = priceFood({ ...pin!, macros_per_base: pin!.macros_per_base }, c.portion);
      for (const [key, value] of Object.entries(c.est)) {
        // Tolerance is rounding only (scaleNutrients keeps 1dp on kcal/grams).
        expect(priced[key as keyof FoodNutrients]).toBeCloseTo(value as number, 1);
      }
    });
  }

  it('reproduces the SAME price on every later log, not merely a close one', () => {
    const pin = nutrientsPerBase({ kcal: 380, protein_g: 14 }, { qty: 1, unit: 'parfait' })!;
    const food = { ...pin };
    const prices = [1, 2, 3].map(() => priceFood(food, { qty: 1, unit: 'parfait', text: 'yogurt parfait' }));
    expect(prices[1]).toEqual(prices[0]);
    expect(prices[2]).toEqual(prices[0]);
  });
});
