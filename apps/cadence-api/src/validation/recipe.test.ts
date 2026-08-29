import { describe, it, expect } from 'vitest';
import { createRecipeBodySchema, patchRecipeBodySchema } from './recipe.ts';

const validBody = {
  name: 'Mushroom sauce',
  servings: 3,
  ingredients: [{ name: 'Button mushrooms', qty: 680, unit: 'g' }],
};

describe('createRecipeBodySchema', () => {
  it('accepts a well-formed recipe', () => {
    const parsed = createRecipeBodySchema.parse(validBody);
    expect(parsed.name).toBe('Mushroom sauce');
    expect(parsed.ingredients).toHaveLength(1);
  });

  it('rejects an empty ingredient list', () => {
    const r = createRecipeBodySchema.safeParse({ ...validBody, ingredients: [] });
    expect(r.success).toBe(false);
  });

  /**
   * MP26/MP10 — `recipe-macros.ts`'s `toMacros` has carried all 12 `@cadence/shared` macro/micro
   * keys since MP26, and this API returns them on every draft it builds (recipe.test.ts's
   * "rosemary" ingredient carries `iron_mg`, for one). Before this fix `macrosSchema` was
   * `.strict()` with only the four macros, so posting that SAME draft back to save it — the
   * confirm-before-save flow this route exists for — 400'd on the first ingredient carrying a
   * micronutrient. Fail-first: this exact body would throw `ZodError: Unrecognized key(s)` on the
   * pre-fix schema; it must parse clean now.
   */
  it('accepts every micronutrient key an ingredient est can carry, round-tripped from a draft', () => {
    const body = {
      ...validBody,
      ingredients: [
        {
          name: 'Rosemary',
          qty: 1,
          unit: 'tbsp',
          est: {
            kcal: 5.6,
            protein_g: 0.1,
            carbs_g: 1.1,
            fat_g: 0.3,
            fiber_g: 0.7,
            sodium_mg: 1,
            iron_mg: 0.48,
            zinc_mg: 0.05,
            vitamin_c_mg: 0.4,
            calcium_mg: 21.8,
            potassium_mg: 27,
            vitamin_b12_ug: 0,
            source: 'ai' as const,
          },
        },
      ],
    };
    const r = createRecipeBodySchema.safeParse(body);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.ingredients[0]?.est?.iron_mg).toBeCloseTo(0.48, 2);
  });

  it("still rejects a typo'd key in est (strict stays strict)", () => {
    const r = createRecipeBodySchema.safeParse({
      ...validBody,
      ingredients: [{ name: 'X', qty: 1, est: { kcal: 5, iron_mgs: 1 } }],
    });
    expect(r.success).toBe(false);
  });

  /**
   * MP10 — the explicit "this ingredient has no numbers" signal must survive the same round trip
   * `est` does: a draft returned with `unresolved: true` on an ingredient has to still say so when
   * posted back to save.
   */
  it('accepts unresolved + reason on an ingredient, and rejects unresolved: false', () => {
    const ok = createRecipeBodySchema.safeParse({
      ...validBody,
      ingredients: [
        {
          name: 'A truly unknowable ingredient',
          qty: 1,
          unresolved: true,
          reason: 'could not identify or estimate this ingredient',
        },
      ],
    });
    expect(ok.success).toBe(true);

    // unresolved is meaningful only as `true` — `false` would silently claim "we checked and there
    // IS nothing", the opposite of what an absent field already means, so it isn't a valid value.
    const bad = createRecipeBodySchema.safeParse({
      ...validBody,
      ingredients: [{ name: 'X', qty: 1, unresolved: false }],
    });
    expect(bad.success).toBe(false);
  });
});

describe('patchRecipeBodySchema', () => {
  it('accepts a partial update', () => {
    const r = patchRecipeBodySchema.safeParse({ name: 'New name' });
    expect(r.success).toBe(true);
  });

  it('rejects an empty patch', () => {
    const r = patchRecipeBodySchema.safeParse({});
    expect(r.success).toBe(false);
  });
});
