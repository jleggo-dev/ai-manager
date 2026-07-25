import { describe, expect, it } from 'vitest';
import { buildOffServings, mapOffProductToFood, normalizeBarcode, nutrientsFromOffNutriments } from './map-product.ts';

describe('normalizeBarcode', () => {
  it('strips non-digits and accepts 8–14 length', () => {
    expect(normalizeBarcode('3017-6204-22003')).toBe('3017620422003');
    expect(normalizeBarcode('123')).toBeNull();
  });
});

describe('nutrientsFromOffNutriments', () => {
  it('maps macros per 100g and converts sodium g→mg', () => {
    const n = nutrientsFromOffNutriments({
      'energy-kcal_100g': 539,
      proteins_100g: 6.3,
      carbohydrates_100g: 57.5,
      fat_100g: 30.9,
      fiber_100g: 3.7,
      sodium_100g: 0.0428,
    });
    expect(n).toMatchObject({
      kcal: 539,
      protein_g: 6.3,
      carbs_g: 57.5,
      fat_g: 30.9,
      fiber_g: 3.7,
      sodium_mg: 42.8,
    });
  });

  it('returns null without macros', () => {
    expect(nutrientsFromOffNutriments({ fiber_100g: 1 })).toBeNull();
  });
});

describe('mapOffProductToFood', () => {
  it('builds a shared OFF food payload with serving + 100g', () => {
    const food = mapOffProductToFood('3017620422003', {
      product_name: 'Nutella',
      brands: 'Ferrero, Yum',
      nutriments: {
        'energy-kcal_100g': 539,
        proteins_100g: 6.3,
        carbohydrates_100g: 57.5,
        fat_100g: 30.9,
      },
      serving_quantity: 15,
      serving_quantity_unit: 'g',
      serving_size: '15 g',
      nutrition_data_per: '100g',
    });
    expect(food).toMatchObject({
      name: 'Nutella',
      brand: 'Ferrero',
      off_id: '3017620422003',
      base_unit: 'g',
    });
    expect(food?.servings[0]).toMatchObject({ unit: 'serving', amount_g: 15 });
    expect(food?.servings.some((s) => s.amount_g === 100)).toBe(true);
  });
});

describe('buildOffServings', () => {
  it('always includes a 100 base option', () => {
    const servings = buildOffServings({}, 'ml');
    expect(servings).toEqual([{ label: '100 ml', unit: 'ml', amount_g: 100 }]);
  });
});
