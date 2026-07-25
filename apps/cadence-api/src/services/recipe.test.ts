/**
 * Req 5 WS3 — recipe service paths (from-chat + create + log correlation).
 * Real Cadence Postgres + mocked AI seam. Skips when no CADENCE_* DB env.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

const HAS_DB = !!(process.env.CADENCE_DATABASE_URL || process.env.CADENCE_DB_PASSWORD);
const d = HAS_DB ? describe : describe.skip;

const USER = '00000000-0000-4000-a000-00000000a105';

vi.mock('../ai/aim.ts', () => ({ runJob: vi.fn(), runJobBySlug: vi.fn() }));

let sql: (typeof import('../db/sql.ts'))['sql'];
let createRecipe: (typeof import('./recipe.ts'))['createRecipe'];
let recipeFromChat: (typeof import('./recipe.ts'))['recipeFromChat'];
let insertFood: (typeof import('../repos/foods.ts'))['insertFood'];
let logMeal: (typeof import('./nutrition.ts'))['logMeal'];
let setDietaryProfile: (typeof import('../repos/users.ts'))['setDietaryProfile'];
let resetUserData: (typeof import('./dev-reset.ts'))['resetUserData'];
let runJobBySlug: ReturnType<typeof vi.fn>;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

d('WS3 — recipe service (DB)', () => {
  beforeAll(async () => {
    ({ sql } = await import('../db/sql.ts'));
    ({ createRecipe, recipeFromChat } = await import('./recipe.ts'));
    ({ insertFood } = await import('../repos/foods.ts'));
    ({ logMeal } = await import('./nutrition.ts'));
    ({ setDietaryProfile } = await import('../repos/users.ts'));
    ({ resetUserData } = await import('./dev-reset.ts'));
    ({ runJobBySlug } = (await import('../ai/aim.ts')) as unknown as {
      runJobBySlug: ReturnType<typeof vi.fn>;
    });
  });

  afterAll(async () => {
    if (resetUserData) await resetUserData(USER);
    if (sql) await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetUserData(USER);
  });

  afterEach(() => {
    runJobBySlug.mockReset();
  });

  it('createRecipe computes per-serving macros from resolved foods', async () => {
    const beef = await insertFood(USER, {
      name: 'Ground beef',
      source: 'manual',
      base_unit: 'g',
      macros_per_base: { kcal: 250, protein_g: 26, carbs_g: 0, fat_g: 17 },
      servings: [{ label: '100 g', unit: 'g', amount_g: 100 }],
      default_serving: 0,
      confidence: 1,
    });
    const beans = await insertFood(USER, {
      name: 'Black beans',
      source: 'manual',
      base_unit: 'g',
      macros_per_base: { kcal: 90, protein_g: 6, carbs_g: 15, fat_g: 0.5 },
      servings: [{ label: '1 can (400g)', unit: 'can', amount_g: 400 }],
      default_serving: 0,
      confidence: 1,
    });

    const { recipe, dietary } = await createRecipe(USER, {
      name: 'Beef chili',
      source: 'user',
      servings: 6,
      ingredients: [
        { food_id: beef.food_id, name: 'Ground beef', qty: 500, unit: 'g' },
        { food_id: beans.food_id, name: 'Black beans', qty: 2, unit: 'can' },
      ],
    });

    expect(recipe.saved).toBe(true);
    expect(recipe.macros_per_serving.kcal).toBeCloseTo(328.3, 0);
    expect(dietary.safe).toBe(true);

    const row = await logMeal(USER, {
      recipe_id: recipe.recipe_id,
      meal: 'dinner',
      quantity: 2,
      date: today(),
    });
    expect(runJobBySlug).not.toHaveBeenCalled();
    expect(row.recipe_id).toBe(recipe.recipe_id);
    expect(row.macros?.kcal).toBeCloseTo(656.7, 0);
    expect(row.items[0]?.name).toBe('Beef chili');
    expect(row.items[0]?.qty).toBe(2);
  });

  it('recipeFromChat structures, resolves, and allergen-flags without saving', async () => {
    await setDietaryProfile(USER, {
      allergies: ['peanuts'],
      diet: null,
      dislikes: [],
      notes: null,
    });
    const peanutButter = await insertFood(USER, {
      name: 'Peanut butter',
      source: 'manual',
      base_unit: 'g',
      macros_per_base: { kcal: 588, protein_g: 25, carbs_g: 20, fat_g: 50 },
      servings: [{ label: '100 g', unit: 'g', amount_g: 100 }],
      default_serving: 0,
      confidence: 1,
    });

    runJobBySlug.mockImplementation(async (_uid: string, slug: string) => {
      if (slug === 'structure-recipe') {
        return {
          formatted: JSON.stringify({
            name: 'PB oats',
            servings: 2,
            ingredients: [
              { name: 'Peanut butter', qty: 32, unit: 'g' },
              { name: 'oats', qty: 80, unit: 'g' },
            ],
            steps: [],
          }),
        };
      }
      if (slug === 'estimate-food') {
        return {
          formatted: JSON.stringify({
            name: 'Rolled oats',
            brand: null,
            serving_size: 40,
            serving_unit: 'g',
            serving_label: '40 g',
            macros_per_serving: { kcal: 150, protein_g: 5, carbs_g: 27, fat_g: 3 },
            confidence: 0.8,
          }),
        };
      }
      throw new Error(`unexpected job ${slug}`);
    });

    const draft = await recipeFromChat(USER, 'oats with peanut butter, makes 2 bowls');
    expect(draft.saved).toBe(false);
    expect(draft.source).toBe('ai_from_chat');
    expect(draft.servings).toBe(2);
    expect(draft.dietary.safe).toBe(false);
    expect(draft.dietary.flags.some((f) => f.severity === 'allergy')).toBe(true);
    const pb = draft.ingredients.find((i) => i.food_id === peanutButter.food_id);
    expect(pb).toBeTruthy();
    expect(draft.macros_per_serving.kcal).toBeGreaterThan(0);

    const count = await sql<{ n: number }[]>`
      select count(*)::int as n from cadence.recipes where user_id = ${USER}`;
    expect(count[0]?.n).toBe(0);
  });
});
