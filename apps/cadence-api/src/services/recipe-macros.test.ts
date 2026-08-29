import { describe, it, expect } from 'vitest';
import type { Food } from '@cadence/shared';
import { priceFood } from './food-pricing-portion.ts';
import { computeMacrosPerServing, priceIngredientAmount, scaleMacros, sumMacros, toMacros } from './recipe-macros.ts';

/** `priceIngredientAmount(...).nutrients` — the shape these tests exercised before MP2 retired
 *  the 3-arg `macrosForIngredientAmount` shim (recipe.ts's last three callers migrated to
 *  `priceIngredientAmount` directly, so nothing in production called the 3-arg shape any more). */
function priced(
  food: Pick<Food, 'base_unit' | 'macros_per_base' | 'servings' | 'default_serving'>,
  qty: number,
  unit?: string,
) {
  return priceIngredientAmount(food, qty, unit).nutrients;
}

function beef(): Pick<Food, 'base_unit' | 'macros_per_base' | 'servings' | 'default_serving'> {
  return {
    base_unit: 'g',
    macros_per_base: { kcal: 250, protein_g: 26, carbs_g: 0, fat_g: 17 },
    servings: [
      { label: '100 g', unit: 'g', amount_g: 100 },
      { label: '1 oz', unit: 'oz', amount_g: 28 },
    ],
    default_serving: 0,
  };
}

function beans(): Pick<Food, 'base_unit' | 'macros_per_base' | 'servings' | 'default_serving'> {
  return {
    base_unit: 'g',
    macros_per_base: { kcal: 90, protein_g: 6, carbs_g: 15, fat_g: 0.5 },
    servings: [{ label: '1 can (400g)', unit: 'can', amount_g: 400 }],
    default_serving: 0,
  };
}

describe('priceIngredientAmount', () => {
  it('scales grams against macros_per_base (per 100g)', () => {
    const m = priced(beef(), 500, 'g');
    expect(m.kcal).toBeCloseTo(1250, 0);
    expect(m.protein_g).toBeCloseTo(130, 0);
  });

  it('matches named serving units (can × qty)', () => {
    const m = priced(beans(), 2, 'can');
    // 400g × 2 / 100 × 90 kcal = 720
    expect(m.kcal).toBeCloseTo(720, 0);
    expect(m.protein_g).toBeCloseTo(48, 0);
  });

  /**
   * MP0c / FOOD-ENGINE.md §2.1: this test used to be named "falls back to default serving × qty
   * when unit unknown" and asserted `m.kcal ≈ 360` — i.e. "bowl" (which beans() has no serving
   * for) silently priced as 1× the food's "1 can (400g)" default. That IS the bug this whole PR
   * exists to remove: an unrecognised unit must return unresolved, never a plausible number. The
   * assertion is inverted on purpose — this is the fail-first test for the fix, not a regression
   * test for the old behaviour.
   */
  it('an unrecognised unit returns no macros rather than the default serving priced as if it answered', () => {
    const m = priced(beans(), 1, 'bowl');
    expect(m.kcal).not.toBeCloseTo(360, 0); // the old, silently-wrong answer
    expect(m).toEqual({});
  });

  it('reports WHY, for a caller that reads it', () => {
    const p = priceIngredientAmount(beans(), 1, 'bowl');
    expect(p.nutrients).toEqual({});
    expect(p.unresolved).toBe(true);
    expect(p.reason).toMatch(/no ".*" measure/);
  });

  /**
   * MP0c: the log path (`portionFactor`/`priceFood`) and the recipe path
   * (`priceIngredientAmount`) used to be two independently-written resolvers that could disagree
   * by up to 16× on the same input — 500 ml of evaporated milk priced at 500 g on the log path
   * (MP0a: ml read as g) and 8,000 g on the recipe path (a substring match on the food's SMALLEST
   * ml-labelled serving, then multiplied by the raw request of 500 as if it were 500 OF that
   * serving — see food-pricing-portion.test.ts for the same case traced through the log path).
   * `priceIngredientAmount` is now a thin caller of `portionFactor`, so there is exactly one answer
   * regardless of which path asks.
   */
  it('agrees exactly with the log path — no more 16× disagreement on the same input', () => {
    const evapMilk: Pick<Food, 'base_unit' | 'macros_per_base' | 'servings' | 'default_serving'> = {
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
    };
    const viaRecipePath = priced(evapMilk, 500, 'ml');
    const viaLogPath = priceFood(evapMilk, { qty: 500, unit: 'ml' });
    expect(viaRecipePath.kcal).toBeCloseTo(viaLogPath.kcal!, 6);
    // Both now correct (~713.7 kcal, scaled from the food's own 250 ml row) — neither the old
    // 500 g reading (670 kcal) nor the old 8,000 g reading (10,720 kcal).
    expect(viaRecipePath.kcal).toBeCloseTo(713.7, 0);
  });

  /**
   * MP26: this file used to declare its OWN `MACRO_KEYS = ['kcal','protein_g','carbs_g','fat_g']`,
   * shadowing the 12-key export from `@cadence/shared` — so a food carrying iron, calcium,
   * potassium (as every CNF row does) had them discarded the moment a recipe touched it, even
   * after a label parse upstream had captured them.
   */
  it('carries micronutrients through, not just the four macros', () => {
    const rosemary: Pick<Food, 'base_unit' | 'macros_per_base' | 'servings' | 'default_serving'> = {
      base_unit: 'g',
      macros_per_base: { kcal: 331, protein_g: 4.9, carbs_g: 64.1, fat_g: 15.2, iron_mg: 28.12, calcium_mg: 1280 },
      servings: [{ label: '100 g', unit: 'g', amount_g: 100 }],
      default_serving: 0,
    };
    const m = toMacros(priced(rosemary, 100, 'g'));
    // FAILS on pre-fix code: the local 4-key MACRO_KEYS meant iron_mg/calcium_mg never survived
    // `toMacros`, regardless of whether the pricer itself carried them.
    expect(m.iron_mg).toBeCloseTo(28.12, 1);
    expect(m.calcium_mg).toBeCloseTo(1280, 0);
    expect(m.kcal).toBeCloseTo(331, 0);
  });

  it('sums micronutrients across ingredients too (sumMacros / scaleMacros)', () => {
    const a = toMacros({ kcal: 100, iron_mg: 2 });
    const b = toMacros({ kcal: 50, iron_mg: 1.5 });
    const total = sumMacros([a, b]);
    expect(total.iron_mg).toBeCloseTo(3.5, 1);
    expect(scaleMacros(total, 2).iron_mg).toBeCloseTo(7, 1);
  });

  /**
   * The "3 shallots" case (FOOD-ENGINE.md §2.2), reached through the recipe path specifically.
   * Without a name/text to resolve against, a bare count has nothing to match a food's count
   * serving on and correctly stays `{}` rather than guessing. Verified here with a food that
   * genuinely has no per-item count serving (real "Shallot, raw" shape: only volume/mass
   * measures), which must resolve to `unresolved`, not a guess either way.
   */
  it('a bare count with no name has nothing to resolve against — unresolved, not a guess', () => {
    const shallot: Pick<Food, 'base_unit' | 'macros_per_base' | 'servings' | 'default_serving'> = {
      base_unit: 'g',
      macros_per_base: { kcal: 72, protein_g: 2.5, carbs_g: 16.8, fat_g: 0.1 },
      servings: [
        { unit: '15ml chopped', label: '15ml chopped (10.1g)', amount_g: 10.1 },
        { unit: 'g', label: '100 g', amount_g: 100 },
      ],
      default_serving: 1,
    };
    // Without the name, there is nothing to resolve — correctly {} rather than a guess.
    expect(priced(shallot, 3, undefined)).toEqual({});

    // With the name (what recipe.ts now passes as of MP2 — see recipe.test.ts for the version of
    // this fixture that DOES carry a count serving and prices instead of refusing), still
    // correctly unresolved here, now WITH a reason a caller could act on.
    const p = priceIngredientAmount(shallot, 3, undefined, '3 shallots');
    expect(p.nutrients).toEqual({});
    expect(p.unresolved).toBe(true);
    expect(p.reason).toBeTruthy();
  });

  /**
   * The positive twin of the test above: MP2's whole point is that `recipe.ts` now threads the
   * ingredient's own name through, so a food that DOES carry a count serving for "shallot" prices
   * instead of refusing. `matchMeasure`'s count branch matches on the noun, singularised — "3
   * shallots" against a "1 shallot" row.
   */
  it('a bare count WITH the name matches the food’s own count serving', () => {
    const shallot: Pick<Food, 'base_unit' | 'macros_per_base' | 'servings' | 'default_serving'> = {
      base_unit: 'g',
      macros_per_base: { kcal: 72, protein_g: 2.5, carbs_g: 16.8, fat_g: 0.1 },
      servings: [
        { unit: 'shallot', label: '1 shallot (25g)', amount_g: 25 },
        { unit: 'g', label: '100 g', amount_g: 100 },
      ],
      default_serving: 1,
    };
    const p = priceIngredientAmount(shallot, 3, undefined, '3 shallots');
    expect(p.unresolved).toBeUndefined();
    // 3 × 25 g = 75 g → 75/100 × 72 kcal = 54
    expect(p.nutrients.kcal).toBeCloseTo(54, 0);
  });
});

describe('computeMacrosPerServing', () => {
  it('divides the batch total by servings (chili-style)', () => {
    const beefM = toMacros(priced(beef(), 500, 'g'));
    const beansM = toMacros(priced(beans(), 2, 'can'));
    const per = computeMacrosPerServing([beefM, beansM], 6);
    // (1250 + 720) / 6 = 328.33
    expect(per.kcal).toBeCloseTo(328.3, 0);
    expect(per.protein_g).toBeCloseTo(29.7, 0);
    expect(per.source).toBe('ai');
  });

  it('returns empty macros when servings invalid', () => {
    expect(computeMacrosPerServing([{ kcal: 100 }], 0)).toEqual({ source: 'ai' });
  });
});

describe('sumMacros / scaleMacros', () => {
  it('sums and scales for logging N servings', () => {
    const total = sumMacros([
      { kcal: 100, protein_g: 10 },
      { kcal: 50, protein_g: 5 },
    ]);
    expect(total.kcal).toBe(150);
    expect(scaleMacros(total, 2).kcal).toBe(300);
  });
});
