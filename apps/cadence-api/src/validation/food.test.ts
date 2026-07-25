import { describe, it, expect } from 'vitest';
import {
  createFoodBodySchema,
  estimateFoodBodySchema,
  identifyFoodBodySchema,
  parseLabelBodySchema,
  patchFoodBodySchema,
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
