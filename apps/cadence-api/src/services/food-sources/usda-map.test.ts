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
