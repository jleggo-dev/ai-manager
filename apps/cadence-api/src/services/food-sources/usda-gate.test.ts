import { describe, it, expect } from 'vitest';
import type { Food } from '@cadence/shared';
import { hasStrongLocalHit, isGenericWholeFoodQuery, shouldQueryUsda } from './usda-gate.ts';

function food(name: string, brand: string | null = null): Food {
  return {
    food_id: 'f1',
    owner_user_id: null,
    visibility: 'shared',
    name,
    brand,
    source: 'usda',
    off_id: null,
    fdc_id: 1,
    base_unit: 'g',
    macros_per_base: { kcal: 100 },
    servings: [{ label: '100 g', unit: 'g', amount_g: 100 }],
    default_serving: 0,
    confidence: 1,
    photo_ref: null,
  };
}

describe('isGenericWholeFoodQuery', () => {
  it('accepts short whole-food queries', () => {
    expect(isGenericWholeFoodQuery('banana')).toBe(true);
    expect(isGenericWholeFoodQuery('rolled oats')).toBe(true);
  });

  it('rejects barcodes, empty, and label dumps', () => {
    expect(isGenericWholeFoodQuery('')).toBe(false);
    expect(isGenericWholeFoodQuery('a')).toBe(false);
    expect(isGenericWholeFoodQuery('012345678901')).toBe(false);
    expect(isGenericWholeFoodQuery('x'.repeat(90))).toBe(false);
  });
});

describe('shouldQueryUsda', () => {
  it('skips USDA when local lexical hit is strong', () => {
    const local = [food('Bananas, raw')];
    expect(hasStrongLocalHit('banana', local)).toBe(true);
    expect(shouldQueryUsda('banana', local)).toBe(false);
  });

  it('queries USDA on cache miss for generic foods', () => {
    expect(shouldQueryUsda('spinach', [])).toBe(true);
    expect(shouldQueryUsda('spinach', [food('Greek Yogurt', 'Fage')])).toBe(true);
  });
});
