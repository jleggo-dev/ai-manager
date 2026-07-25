import { describe, expect, it } from 'vitest';
import { dietaryProfileBodySchema } from './dietary.ts';

describe('dietaryProfileBodySchema', () => {
  it('accepts a full profile', () => {
    const parsed = dietaryProfileBodySchema.parse({
      allergies: ['peanuts'],
      diet: 'vegan',
      dislikes: ['cilantro'],
      notes: 'keep it simple',
    });
    expect(parsed).toEqual({
      allergies: ['peanuts'],
      diet: 'vegan',
      dislikes: ['cilantro'],
      notes: 'keep it simple',
    });
  });

  it('defaults lists and nulls omitted soft fields', () => {
    const parsed = dietaryProfileBodySchema.parse({});
    expect(parsed.allergies).toEqual([]);
    expect(parsed.dislikes).toEqual([]);
    expect(parsed.diet).toBeNull();
    expect(parsed.notes).toBeNull();
  });

  it('rejects empty allergy tags', () => {
    expect(() => dietaryProfileBodySchema.parse({ allergies: ['  '] })).toThrow();
  });
});
