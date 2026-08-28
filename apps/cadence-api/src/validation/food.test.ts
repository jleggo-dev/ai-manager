import { describe, it, expect } from 'vitest';
import {
  createFoodBodySchema,
  estimateFoodBodySchema,
  identifyFoodBodySchema,
  importOffFoodBodySchema,
  parseLabelBodySchema,
  patchFoodBodySchema,
  resolveFoodBodySchema,
} from './food.ts';

const validBody = {
  name: 'Nonfat Greek Yogurt',
  brand: 'Fage',
  source: 'manual' as const,
  base_unit: 'g' as const,
  macros_per_base: { kcal: 59, protein_g: 10.3, carbs_g: 3.5, fat_g: 0 },
  servings: [
    { label: '1 container (170g)', unit: 'container', amount_g: 170 },
    { label: '100 g', unit: 'g', amount_g: 100 },
  ],
  default_serving: 0,
};

describe('createFoodBodySchema', () => {
  it('accepts a well-formed MFP-style food', () => {
    const parsed = createFoodBodySchema.parse(validBody);
    expect(parsed.name).toBe('Nonfat Greek Yogurt');
    expect(parsed.servings).toHaveLength(2);
  });

  it('rejects empty servings', () => {
    const r = createFoodBodySchema.safeParse({ ...validBody, servings: [] });
    expect(r.success).toBe(false);
  });

  it('rejects default_serving past the end of servings', () => {
    const r = createFoodBodySchema.safeParse({ ...validBody, default_serving: 5 });
    expect(r.success).toBe(false);
  });

  it('rejects unknown nutrient keys (strict)', () => {
    const r = createFoodBodySchema.safeParse({
      ...validBody,
      macros_per_base: { kcal: 1, mystery: 9 },
    });
    expect(r.success).toBe(false);
  });

  it('accepts vitamin_b12_ug — carried everywhere else in the system (MP28)', () => {
    const r = createFoodBodySchema.safeParse({
      ...validBody,
      macros_per_base: { ...validBody.macros_per_base, vitamin_b12_ug: 1.2 },
    });
    expect(r.success).toBe(true);
  });

  it('accepts every real food source: off, usda, fatsecret, cnf, research (MP28)', () => {
    for (const source of ['off', 'usda', 'fatsecret', 'cnf', 'research'] as const) {
      const r = createFoodBodySchema.safeParse({ ...validBody, source });
      expect(r.success, `source "${source}" should be accepted`).toBe(true);
    }
  });
});

describe('patchFoodBodySchema', () => {
  it('allows a partial name patch', () => {
    expect(patchFoodBodySchema.parse({ name: 'Greek Yogurt' }).name).toBe('Greek Yogurt');
  });

  it('allows clearing brand to null', () => {
    expect(patchFoodBodySchema.parse({ brand: null }).brand).toBeNull();
  });
});

describe('capture body schemas', () => {
  it('parse-label requires a data:image photo', () => {
    expect(() => parseLabelBodySchema.parse({ photo: 'http://x' })).toThrow(/data:image/);
    expect(parseLabelBodySchema.parse({ photo: 'data:image/jpeg;base64,abc', hint: ' Fage ' })).toMatchObject({
      photo: 'data:image/jpeg;base64,abc',
      hint: 'Fage',
    });
  });

  it('estimate requires non-empty text', () => {
    expect(() => estimateFoodBodySchema.parse({ text: '  ' })).toThrow();
    expect(estimateFoodBodySchema.parse({ text: ' greek yogurt ' })).toEqual({ text: 'greek yogurt' });
  });

  it('identify requires a data:image photo', () => {
    expect(() => identifyFoodBodySchema.parse({})).toThrow();
    expect(identifyFoodBodySchema.parse({ photo: 'data:image/png;base64,x' }).photo).toMatch(/^data:image/);
  });
});

describe('importOffFoodBodySchema', () => {
  const offBody = {
    name: 'Nutella',
    brand: 'Ferrero',
    off_id: '3017620422003',
    base_unit: 'g' as const,
    macros_per_base: { kcal: 539, protein_g: 6.3, carbs_g: 57.5, fat_g: 30.9 },
    servings: [
      { label: '15 g', unit: 'serving', amount_g: 15 },
      { label: '100 g', unit: 'g', amount_g: 100 },
    ],
  };

  it('accepts a mapped OFF product', () => {
    expect(importOffFoodBodySchema.parse(offBody).off_id).toBe('3017620422003');
  });

  it('rejects a non-digit off_id', () => {
    expect(importOffFoodBodySchema.safeParse({ ...offBody, off_id: 'abc' }).success).toBe(false);
  });

  it('rejects macros with no energy or macros', () => {
    expect(
      importOffFoodBodySchema.safeParse({
        ...offBody,
        macros_per_base: { fiber_g: 1 },
      }).success,
    ).toBe(false);
  });
});

describe('resolveFoodBodySchema', () => {
  it('allows empty body (recents-style resolve)', () => {
    expect(resolveFoodBodySchema.parse({})).toEqual({ text: '', photo: undefined });
  });

  it('trims text', () => {
    expect(resolveFoodBodySchema.parse({ text: '  3 eggs  ' })).toEqual({ text: '3 eggs', photo: undefined });
  });

  it('accepts an optional label photo hint', () => {
    expect(resolveFoodBodySchema.parse({ text: 'Fage', photo: 'data:image/jpeg;base64,x' }).photo).toMatch(
      /^data:image/,
    );
  });
});
