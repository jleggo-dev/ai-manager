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
          // v4 milligrams (v1 would have made these percentages — see the mapper's warning).
          calcium: '40',
          iron: '3',
          vitamin_c: '2',
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
   * v4 gives these in milligrams; v1 gave the same field names as a percentage of daily value.
   * Mapping them is correct ONLY against v4 — see the warning on `nutrientsFromServing`.
   */
  it('carries the v4 micronutrients through, scaled like everything else', () => {
    const f = mapFatSecretFood(PEANUTS)!;
    expect(f.macros_per_base.calcium_mg).toBeCloseTo(56.34, 1); // 40mg in 71g
    expect(f.macros_per_base.iron_mg).toBeCloseTo(4.23, 1);
    expect(f.macros_per_base.vitamin_c_mg).toBeCloseTo(2.82, 1);
  });

  /** FatSecret returns neither, so a food sourced here simply has none — never a guessed zero. */
  /**
   * Found by the first live call: FatSecret returned `potassium: 0` for peanuts, which carry
   * roughly 700mg per 100g. Their fields are documented "(where available)" and absence arrives as
   * a zero, so storing it would be a fabricated measurement — and it would count as "covered" in
   * the micro rollup while contributing nothing.
   */
  it('drops a zero micronutrient, because zero means not available', () => {
    const f = mapFatSecretFood({
      food: {
        food_id: '1',
        food_name: 'Peanuts',
        servings: {
          serving: {
            metric_serving_amount: '28',
            metric_serving_unit: 'g',
            calories: '170',
            fat: '14',
            fiber: '0',
            potassium: '0',
            calcium: '0',
            iron: '0',
            vitamin_c: '0',
            sodium: '0',
          },
        },
      },
    })!;
    expect(f.macros_per_base.potassium_mg).toBeUndefined();
    expect(f.macros_per_base.calcium_mg).toBeUndefined();
    expect(f.macros_per_base.iron_mg).toBeUndefined();
    expect(f.macros_per_base.vitamin_c_mg).toBeUndefined();
    expect(f.macros_per_base.sodium_mg).toBeUndefined();
    // Energy and macros keep their zeros — those are real measurements.
    expect(f.macros_per_base.fiber_g).toBe(0);
    expect(f.macros_per_base.kcal).toBeCloseTo(607.14, 1);
  });

  it('leaves zinc and B12 absent rather than inventing them', () => {
    const f = mapFatSecretFood(PEANUTS)!;
    expect(f.macros_per_base.zinc_mg).toBeUndefined();
    expect(f.macros_per_base.vitamin_b12_ug).toBeUndefined();
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
   * The restaurant case, and the reason FatSecret is here at all. A live lookup of Starbucks'
   * Caffè Latte (Venti) declares "20 oz" — ambiguous between fluid and weight ounces, so it is
   * mapped as ONE OF ITSELF rather than converted on a guess.
   */
  it('maps a restaurant item measured in ounces as a single serving', () => {
    const f = mapFatSecretFood({
      food: {
        food_id: '125075080',
        food_name: 'Caffè Latte (Venti)',
        brand_name: 'Starbucks',
        servings: {
          serving: {
            serving_description: '1 serving',
            measurement_description: 'serving',
            metric_serving_amount: '20.000',
            metric_serving_unit: 'oz',
            calories: '250',
            protein: '16.00',
            fat: '9.00',
            carbohydrate: '24.00',
            sodium: '220',
          },
        },
      },
    })!;
    expect(f.base_unit).toBe('item');
    // Per ONE latte, unscaled — no ounce conversion was guessed at.
    expect(f.macros_per_base).toMatchObject({ kcal: 250, protein_g: 16, fat_g: 9, sodium_mg: 220 });
    expect(f.servings).toEqual([{ label: '1 serving', unit: 'serving', amount_g: 1 }]);
  });

  it('falls back to a single serving when no metric amount is declared at all', () => {
    const f = mapFatSecretFood({
      food: {
        food_id: '9',
        food_name: 'Mystery',
        servings: { serving: [{ serving_description: '1 plate', calories: '300' }] },
      },
    })!;
    expect(f.base_unit).toBe('item');
    expect(f.macros_per_base.kcal).toBe(300);
    expect(f.servings[0]?.label).toBe('1 plate');
  });

  it('refuses anything missing an id, a name, or servings', () => {
    expect(mapFatSecretFood({})).toBeNull();
    expect(mapFatSecretFood({ food: { food_id: '1' } })).toBeNull();
    expect(mapFatSecretFood({ food: { food_name: 'no id', servings: { serving: [] } } })).toBeNull();
    expect(mapFatSecretFood({ food: { food_id: '2', food_name: 'Empty', servings: { serving: [] } } })).toBeNull();
  });
});
