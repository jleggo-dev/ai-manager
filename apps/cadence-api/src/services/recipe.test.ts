/**
 * Req 5 WS3 — recipe service paths (from-chat + create + log correlation).
 * Real Cadence Postgres + mocked AI seam. Skips when no CADENCE_* DB env.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { testUserId } from './test-user.ts';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

const HAS_DB = !!(process.env.CADENCE_DATABASE_URL || process.env.CADENCE_DB_PASSWORD);
const d = HAS_DB ? describe : describe.skip;

const USER = testUserId('a105');

vi.mock('../ai/aim.ts', () => ({ runJob: vi.fn(), runJobBySlug: vi.fn() }));

let sql: (typeof import('../db/sql.ts'))['sql'];
let createRecipe: (typeof import('./recipe.ts'))['createRecipe'];
let recipeFromChat: (typeof import('./recipe.ts'))['recipeFromChat'];
let getRecipeForUser: (typeof import('./recipe.ts'))['getRecipeForUser'];
let insertFood: (typeof import('../repos/foods.ts'))['insertFood'];
let logMeal: (typeof import('./nutrition.ts'))['logMeal'];
let setDietaryProfile: (typeof import('../repos/users.ts'))['setDietaryProfile'];
let resetUserData: (typeof import('./dev-reset.ts'))['resetUserData'];
let runJobBySlug: ReturnType<typeof vi.fn>;

/** The scenario's own structure_recipe output shape (Req 5 WS3 — meal prep, PLAN.md). */
function mockStructureRecipe(ingredients: Array<{ name: string; qty: number; unit?: string }>) {
  runJobBySlug.mockImplementation(async (_uid: string, slug: string, params?: Record<string, unknown>) => {
    if (slug === 'structure-recipe') {
      return {
        formatted: JSON.stringify({ name: 'Mushroom sauce', servings: 3, ingredients, steps: [] }),
      };
    }
    if (slug === 'estimate-food') {
      throw new Error(`estimate-food should not be needed for "${String(params?.food_text)}"`);
    }
    throw new Error(`unexpected job ${slug}`);
  });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

d('WS3 — recipe service (DB)', () => {
  beforeAll(async () => {
    ({ sql } = await import('../db/sql.ts'));
    ({ createRecipe, recipeFromChat, getRecipeForUser } = await import('./recipe.ts'));
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

  /**
   * MP2/MP9/MP26 — the meal-prep scenario's own mushroom sauce (PLAN.md "Meal prep, end to end"),
   * exercised end to end through recipeFromChat. Before MP2, `3 shallots` (a bare count with no
   * unit — the noun IS the food name) reached the pricer as a nameless qty and always priced at
   * {} — this is the fail-first case: on pre-fix code `shallots.est` is undefined and the recipe
   * silently drops the ingredient's macros with no trace of why.
   */
  it("prices the scenario's own ingredients — a bare count included — through one shared resolve", async () => {
    await insertFood(USER, {
      name: 'Button mushrooms',
      source: 'manual',
      base_unit: 'g',
      macros_per_base: { kcal: 22, protein_g: 3.1, carbs_g: 3.3, fat_g: 0.3 },
      servings: [{ label: '100 g', unit: 'g', amount_g: 100 }],
      default_serving: 0,
      confidence: 1,
    });
    await insertFood(USER, {
      name: 'Shallots',
      source: 'manual',
      base_unit: 'g',
      macros_per_base: { kcal: 72, protein_g: 2.5, carbs_g: 16.8, fat_g: 0.1 },
      servings: [
        { label: '1 shallot (25g)', unit: 'shallot', amount_g: 25 },
        { label: '100 g', unit: 'g', amount_g: 100 },
      ],
      default_serving: 1,
      confidence: 1,
    });
    await insertFood(USER, {
      name: 'Rosemary',
      source: 'manual',
      base_unit: 'g',
      // Carries iron_mg — MP26 already guarantees this survives recipe-macros.ts; this test checks
      // it also survives THIS path end to end, not just the pure function.
      macros_per_base: { kcal: 331, protein_g: 4.9, carbs_g: 64.1, fat_g: 15.2, iron_mg: 28.12 },
      servings: [
        { label: '1 tbsp (1.7g)', unit: 'tbsp', amount_g: 1.7 },
        { label: '100 g', unit: 'g', amount_g: 100 },
      ],
      default_serving: 1,
      confidence: 1,
    });
    await insertFood(USER, {
      name: 'Mixed dried mushroom',
      source: 'manual',
      base_unit: 'g',
      // Per-piece, backed out of the scenario's own label fixture (PLAN.md): 40 kcal / 15 pieces.
      macros_per_base: { kcal: 267, protein_g: 20, carbs_g: 53, fat_g: 6.7, potassium_mg: 1667 },
      servings: [
        { label: '1 piece', unit: 'piece', amount_g: 1 },
        { label: '100 g', unit: 'g', amount_g: 100 },
      ],
      default_serving: 1,
      confidence: 1,
    });

    mockStructureRecipe([
      { name: 'button mushrooms', qty: 680, unit: 'g' },
      { name: 'shallots', qty: 3 }, // bare count, no unit — the MP2 case
      { name: 'rosemary', qty: 1, unit: 'tbsp' },
      { name: 'mixed dried mushroom', qty: 15, unit: 'piece' },
    ]);

    const draft = await recipeFromChat(USER, 'weekend mushroom sauce prep');
    expect(draft.ingredients).toHaveLength(4);
    for (const i of draft.ingredients) {
      expect(i.unresolved, `${i.name} should not be unresolved`).toBeFalsy();
      expect(i.food_id, `${i.name} should have resolved to a food`).toBeTruthy();
    }

    const shallots = draft.ingredients.find((i) => i.name === 'Shallots');
    // 3 × 25 g / 100 × 72 kcal = 54 — FAILS pre-MP2 (shallots.est was undefined: {} nutrients).
    expect(shallots?.est?.kcal).toBeCloseTo(54, 0);

    const mushrooms = draft.ingredients.find((i) => i.name === 'Button mushrooms');
    expect(mushrooms?.est?.kcal).toBeCloseTo(149.6, 0); // 680/100 × 22

    const rosemary = draft.ingredients.find((i) => i.name === 'Rosemary');
    expect(rosemary?.est?.kcal).toBeCloseTo(5.6, 0); // 1.7/100 × 331
    expect(rosemary?.est?.iron_mg).toBeCloseTo(0.48, 1); // micronutrient survives this path too

    const dried = draft.ingredients.find((i) => i.name === 'Mixed dried mushroom');
    expect(dried?.est?.kcal).toBeCloseTo(40, 0); // reproduces the label's own "40 kcal / 15 pieces"

    expect(draft.macros_per_serving.kcal).toBeGreaterThan(0);

    // Confirm-before-save round trip: the draft persists through real Postgres JSONB and reads
    // back with the same food_ids and numbers (validation/recipe.ts's schema is what a real client
    // request goes through — see validation/recipe.test.ts for that layer in isolation).
    const { recipe } = await createRecipe(USER, {
      name: draft.name,
      servings: draft.servings,
      ingredients: draft.ingredients,
    });
    const fetched = await getRecipeForUser(USER, recipe.recipe_id);
    const savedShallots = fetched?.ingredients.find((i) => i.name === 'Shallots');
    expect(savedShallots?.food_id).toBe(shallots?.food_id);
  });

  /**
   * MP8 — owner: "log and save the profile of each ingredient, if we don't already have it."
   * Nothing named "chopped tarragon thing" matches via search, so this falls to estimate_food; the
   * fix pins the estimate as a private Food rather than throwing it away. Fail-first: pre-MP8 the
   * ingredient carries `est` + `estimated: true` but NO `food_id`, and no row is ever written to
   * cadence.foods — the same estimate would be re-bought on every future recipe.
   */
  it('pins an unheld ingredient as a reusable food instead of discarding the estimate', async () => {
    runJobBySlug.mockImplementation(async (_uid: string, slug: string) => {
      if (slug === 'structure-recipe') {
        return {
          formatted: JSON.stringify({
            name: 'Mushroom sauce',
            servings: 3,
            ingredients: [{ name: 'chopped tarragon thing', qty: 1, unit: 'tbsp' }],
            steps: [],
          }),
        };
      }
      if (slug === 'estimate-food') {
        return {
          formatted: JSON.stringify({
            name: 'Chopped Tarragon',
            brand: null,
            serving_size: 1,
            serving_unit: 'tbsp',
            serving_label: '1 tbsp',
            macros_per_serving: { kcal: 5, protein_g: 0.4, carbs_g: 1, fat_g: 0.1 },
            confidence: 0.6,
          }),
        };
      }
      throw new Error(`unexpected job ${slug}`);
    });

    const draft = await recipeFromChat(USER, 'sauce with a chopped tarragon thing');
    const tarragon = draft.ingredients[0];
    expect(tarragon?.estimated).toBe(true);
    expect(tarragon?.food_id, 'the estimate should be pinned, not discarded').toBeTruthy();

    const pinned = await sql<{ food_id: string; owner_user_id: string }[]>`
      select food_id, owner_user_id from cadence.foods where food_id = ${tarragon!.food_id!}`;
    expect(pinned[0]?.owner_user_id).toBe(USER);
  });

  /**
   * MP8 dedup — reuses `findOwnDuplicate` rather than a second, independently-written check.
   * `estimate-food` normalises names ("that green onion thing" → "Green Onions"), so a search on
   * the ORIGINAL words can miss a food already pinned under the CANONICAL name. Without the dedup
   * check this mints a second, near-duplicate row every time the same ingredient is phrased
   * differently — the incident this reuse exists to prevent. The ingredient name below is
   * deliberately lexically unrelated to "green onions" (no shared substring or trigram) so
   * searchFoods is GUARANTEED to miss and this genuinely exercises the estimate→dedupe path,
   * rather than happening to pass via an accidental direct match.
   */
  it('reuses an already-pinned food under its canonical name instead of minting a duplicate', async () => {
    const existing = await insertFood(USER, {
      name: 'Green Onions',
      source: 'llm',
      visibility: 'private',
      base_unit: 'g',
      macros_per_base: { kcal: 32, protein_g: 1.8, carbs_g: 7.3, fat_g: 0.2 },
      servings: [{ label: '100 g', unit: 'g', amount_g: 100 }],
      default_serving: 0,
      confidence: 0.6,
    });

    runJobBySlug.mockImplementation(async (_uid: string, slug: string) => {
      if (slug === 'structure-recipe') {
        return {
          formatted: JSON.stringify({
            name: 'Mushroom sauce',
            servings: 3,
            // No lexical overlap with "Green Onions" at all — guarantees searchFoods misses and
            // this falls to estimate-food, matching pinItem's own "canonical name differs from what
            // was searched" case.
            ingredients: [{ name: 'zqxvk garnish 7', qty: 2, unit: undefined }],
            steps: [],
          }),
        };
      }
      if (slug === 'estimate-food') {
        return {
          formatted: JSON.stringify({
            name: 'Green Onions',
            brand: null,
            serving_size: 100,
            serving_unit: 'g',
            serving_label: '100 g',
            macros_per_serving: { kcal: 32, protein_g: 1.8, carbs_g: 7.3, fat_g: 0.2 },
            confidence: 0.5,
          }),
        };
      }
      throw new Error(`unexpected job ${slug}`);
    });

    const draft = await recipeFromChat(USER, 'sauce with some zqxvk garnish 7');
    expect(draft.ingredients[0]?.food_id).toBe(existing.food_id);

    const rows = await sql<{ n: number }[]>`
      select count(*)::int as n from cadence.foods
      where owner_user_id = ${USER} and lower(name) = 'green onions'`;
    expect(rows[0]?.n).toBe(1); // not 2 — the dedup check caught it
  });

  /**
   * MP10 — an ingredient with no numbers at all must say so explicitly, on both the draft and the
   * saved row. Fail-first: pre-MP10 this case returned `{ name, qty, unit, estimated: true }` with
   * no `est` — `estimated: true` on a row with no numbers is the exact ambiguity MP10 removes, and
   * nothing distinguished "we have not looked yet" from "we looked and found nothing".
   */
  it('an ingredient nothing can price or estimate says so explicitly, and it survives the save', async () => {
    runJobBySlug.mockImplementation(async (_uid: string, slug: string) => {
      if (slug === 'structure-recipe') {
        return {
          formatted: JSON.stringify({
            name: 'Mushroom sauce',
            servings: 3,
            ingredients: [{ name: 'a truly unknowable ingredient', qty: 1, unit: undefined }],
            steps: [],
          }),
        };
      }
      if (slug === 'estimate-food') throw new Error('estimate-food job unavailable');
      throw new Error(`unexpected job ${slug}`);
    });

    const draft = await recipeFromChat(USER, 'sauce with something the coach cannot identify');
    const ing = draft.ingredients[0];
    expect(ing?.est).toBeUndefined();
    expect(ing?.unresolved).toBe(true);
    expect(ing?.reason).toBeTruthy();

    const { recipe } = await createRecipe(USER, {
      name: draft.name,
      servings: draft.servings,
      ingredients: draft.ingredients,
    });
    const fetched = await getRecipeForUser(USER, recipe.recipe_id);
    const savedIng = fetched?.ingredients[0];
    expect(savedIng?.unresolved, 'unresolved must survive the round trip to Postgres and back').toBe(true);
    expect(savedIng?.reason).toBeTruthy();
    expect(savedIng?.est).toBeUndefined();
  });
});
