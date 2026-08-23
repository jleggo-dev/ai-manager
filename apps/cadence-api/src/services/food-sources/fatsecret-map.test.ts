/**
 * FatSecret mapping. Pure: no HTTP, no credentials, no DB.
 *
 * Their nutrients arrive PER SERVING and Cadence stores per base, so the arithmetic here is the
 * same class of trap as `food-pricing-portion`: get the direction wrong and every branded food is
 * off by the size of its own serving.
 */
import { describe, it, expect } from 'vitest';
import { mapFatSecretFood, mapFatSecretSearch } from './fatsecret-map.ts';

/** A branded snack, shaped the way their API answers: one serving, metric amount declared. */
const PEANUTS = {
  food: {
    food_id: '12345',
    food_name: 'Dill Pickle Peanuts',
    brand_name: 'Couche-Tard',
    servings: {
      serving: [
        {
          serving_id: '9001',
          serving_description: '1 pack (71g)',
          measurement_description: 'pack',
          metric_serving_amount: '71.0',
          metric_serving_unit: 'g',
          calories: '420',
          protein: '16',
          carbohydrate: '14',
          fat: '36',
          fiber: '6',
          sodium: '450',
          potassium: '450',
          // Ambiguous between %DV and mg depending on version — deliberately not mapped.
          calcium: '4',
          iron: '6',
        },
      ],
    },
  },
};

describe('mapFatSecretSearch', () => {
  it('reads a list of hits', () => {
    const hits = mapFatSecretSearch({
      foods: {
        food: [
          { food_id: '1', food_name: 'Peanuts', brand_name: 'Planters', food_description: 'Per 28g - 160kcal' },
          { food_id: '2', food_name: 'Peanuts', food_description: 'Per 100g - 567kcal' },
        ],
      },
    });
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ food_id: '1', name: 'Peanuts', brand: 'Planters' });
    expect(hits[1]?.brand).toBeNull();
  });

  /** Their API returns a bare object for one result and an array for several. */
  it('copes with a single result arriving unwrapped', () => {
    const hits = mapFatSecretSearch({ foods: { food: { food_id: '7', food_name: 'Skyr' } } });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.food_id).toBe('7');
  });

  it('returns nothing rather than throwing on an empty or odd shape', () => {
    expect(mapFatSecretSearch({})).toEqual([]);
    expect(mapFatSecretSearch(null)).toEqual([]);
    expect(mapFatSecretSearch({ foods: { food: [{ food_name: 'no id' }] } })).toEqual([]);
  });
});

describe('mapFatSecretFood', () => {
  it('converts per-serving nutrients to per-100', () => {
    const f = mapFatSecretFood(PEANUTS)!;
    expect(f.base_unit).toBe('g');
    // 420 kcal in 71g ⇒ 591.5 per 100g.
    expect(f.macros_per_base.kcal).toBeCloseTo(591.55, 1);
    expect(f.macros_per_base.protein_g).toBeCloseTo(22.54, 1);
    expect(f.macros_per_base.sodium_mg).toBeCloseTo(633.8, 1);
  });

  /**
   * A %DV read as mg is a tenfold error in a nutrient nobody would double-check. Cadence's rule is
   * that a micro is a floor built from real data — missing is honest, wrong is not.
   */
  it('omits the nutrients whose unit is ambiguous between API versions', () => {
    const f = mapFatSecretFood(PEANUTS)!;
    expect(f.macros_per_base.calcium_mg).toBeUndefined();
    expect(f.macros_per_base.iron_mg).toBeUndefined();
    expect(f.macros_per_base.vitamin_c_mg).toBeUndefined();
  });

  it('keeps the pack as a serving and adds a 100-unit option', () => {
    const f = mapFatSecretFood(PEANUTS)!;
    expect(f.servings[0]).toMatchObject({ amount_g: 71, unit: 'pack' });
    expect(f.servings.some((s) => s.amount_g === 100)).toBe(true);
    // The household serving reads better than "100 g" as the default.
    expect(f.default_serving).toBe(0);
  });

  it('carries the id and brand through', () => {
    const f = mapFatSecretFood(PEANUTS)!;
    expect(f.fatsecret_id).toBe('12345');
    expect(f.brand).toBe('Couche-Tard');
  });

  it('handles a drink measured in millilitres', () => {
    const f = mapFatSecretFood({
      food: {
        food_id: '55',
        food_name: 'Latte',
        servings: {
          serving: {
            metric_serving_amount: '250',
            metric_serving_unit: 'ml',
            measurement_description: 'cup',
            calories: '150',
          },
        },
      },
    })!;
    expect(f.base_unit).toBe('ml');
    expect(f.macros_per_base.kcal).toBeCloseTo(60, 1);
  });

  /**
   * Without a metric amount there is no honest way to say "per 100 g", and A23 pins what it
   * prices — so a guess here would become a permanent wrong price.
   */
  it('refuses a food whose servings declare no metric amount', () => {
    expect(
      mapFatSecretFood({
        food: {
          food_id: '9',
          food_name: 'Mystery',
          servings: { serving: [{ serving_description: '1 plate', calories: '300' }] },
        },
      }),
    ).toBeNull();
  });

  it('refuses anything missing an id, a name, or servings', () => {
    expect(mapFatSecretFood({})).toBeNull();
    expect(mapFatSecretFood({ food: { food_id: '1' } })).toBeNull();
    expect(mapFatSecretFood({ food: { food_name: 'no id', servings: { serving: [] } } })).toBeNull();
  });
});
