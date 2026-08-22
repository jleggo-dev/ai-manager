import { describe, it, expect } from 'vitest';
import {
  defaultServingIndex,
  mapUsdaFoodDetail,
  mapUsdaNutrients,
  mapUsdaPortions,
  parseUsdaSearchHit,
} from './usda-map.ts';

describe('mapUsdaNutrients', () => {
  it('maps nutrient numbers to FoodNutrients (per 100g)', () => {
    const nutrients = mapUsdaNutrients([
      { nutrient: { id: 1008, number: 1008, name: 'Energy', unitName: 'kcal' }, amount: 89 },
      { nutrient: { number: 1003, name: 'Protein', unitName: 'g' }, amount: 1.09 },
      { nutrient: { number: 1005, name: 'Carbohydrate', unitName: 'g' }, amount: 22.84 },
      { nutrient: { number: 1004, name: 'Fat', unitName: 'g' }, amount: 0.33 },
      { nutrient: { number: 1095, name: 'Zinc', unitName: 'mg' }, amount: 0.15 },
      { nutrient: { number: 1008, name: 'Energy', unitName: 'kJ' }, amount: 371 },
    ]);
    expect(nutrients.kcal).toBe(89);
    expect(nutrients.protein_g).toBe(1.1);
    expect(nutrients.carbs_g).toBe(22.8);
    expect(nutrients.fat_g).toBe(0.3);
    expect(nutrients.zinc_mg).toBe(0.15);
  });

  it('maps vitamin B-12 (FDC id 1178) in µg at 2 decimal places', () => {
    const nutrients = mapUsdaNutrients([
      { nutrient: { id: 1178, number: '418', name: 'Vitamin B-12', unitName: 'µg' }, amount: 0.443 },
      { nutrient: { id: 1246, number: '578', name: 'Vitamin B-12, added', unitName: 'µg' }, amount: 0.9 },
    ]);
    // 0.44, not 0.4 — '_ug' must not fall into the '_g' 1dp bucket.
    expect(nutrients.vitamin_b12_ug).toBe(0.44);
    // "added" B-12 (1246) is a subset of the 1178 total — never mapped on its own.
    expect(Object.keys(nutrients)).toEqual(['vitamin_b12_ug']);
  });

  it('maps a real full-format payload, where nutrient.number is the legacy code and only the id matches', () => {
    // Trimmed from live GET /v1/food/175167 (salmon, SR Legacy): entry.id is the row id,
    // nutrient.id the FDC id we key on, nutrient.number the legacy string code.
    const nutrients = mapUsdaNutrients([
      {
        type: 'FoodNutrient',
        id: 1817900,
        nutrient: { id: 1008, number: '208', name: 'Energy', rank: 300, unitName: 'kcal' },
        amount: 208,
      },
      {
        type: 'FoodNutrient',
        id: 1817879,
        nutrient: { id: 1062, number: '268', name: 'Energy', rank: 400, unitName: 'kJ' },
        amount: 870,
      },
      {
        type: 'FoodNutrient',
        id: 1817943,
        nutrient: { id: 1003, number: '203', name: 'Protein', rank: 600, unitName: 'g' },
        amount: 20.42,
      },
      {
        type: 'FoodNutrient',
        id: 1817905,
        nutrient: { id: 1178, number: '418', name: 'Vitamin B-12', rank: 7300, unitName: 'µg' },
        amount: 3.23,
      },
    ]);
    expect(nutrients.kcal).toBe(208);
    expect(nutrients.protein_g).toBe(20.4);
    expect(nutrients.vitamin_b12_ug).toBe(3.23);
  });
});

describe('mapUsdaPortions', () => {
  it('maps household portions and always includes 100 g', () => {
    const servings = mapUsdaPortions([
      { amount: 1, modifier: 'medium', gramWeight: 118, measureUnit: { name: 'fruit' } },
      { amount: 1, modifier: 'cup', gramWeight: 150, measureUnit: { name: 'slices' } },
    ]);
    expect(servings.some((s) => s.amount_g === 118)).toBe(true);
    expect(servings.some((s) => s.unit === 'g' && s.amount_g === 100)).toBe(true);
    expect(defaultServingIndex(servings)).toBe(0);
  });
});

describe('parseUsdaSearchHit / mapUsdaFoodDetail', () => {
  it('parses a search hit', () => {
    const hit = parseUsdaSearchHit({
      fdcId: 173944,
      description: 'Bananas, raw',
      dataType: 'SR Legacy',
    });
    expect(hit).toEqual({
      fdc_id: 173944,
      name: 'Bananas, raw',
      brand: null,
      data_type: 'SR Legacy',
    });
  });

  it('maps a full food detail into an importable Food shape', () => {
    const mapped = mapUsdaFoodDetail({
      fdcId: 173944,
      description: 'Bananas, raw',
      foodNutrients: [
        { nutrient: { number: 1008, unitName: 'kcal' }, amount: 89 },
        { nutrient: { number: 1003, unitName: 'g' }, amount: 1.09 },
      ],
      foodPortions: [{ amount: 1, modifier: 'medium', gramWeight: 118, measureUnit: { name: 'fruit' } }],
    });
    expect(mapped).not.toBeNull();
    expect(mapped!.source).toBe('usda');
    expect(mapped!.fdc_id).toBe(173944);
    expect(mapped!.base_unit).toBe('g');
    expect(mapped!.macros_per_base.kcal).toBe(89);
    expect(mapped!.servings.length).toBeGreaterThanOrEqual(2);
    expect(mapped!.off_id).toBeNull();
  });

  it('rejects detail with no macros', () => {
    expect(
      mapUsdaFoodDetail({
        fdcId: 1,
        description: 'Water',
        foodNutrients: [{ nutrient: { number: 1095 }, amount: 0 }],
        foodPortions: [],
      }),
    ).toBeNull();
  });
});
