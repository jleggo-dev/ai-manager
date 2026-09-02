/**
 * The draft meal lifecycle (meal-logging rework 1b) against a real Cadence Postgres — the same
 * harness as plan-commit.test.ts: a per-process test user, the AI seam fully mocked (nothing in
 * the draft path calls a model, but importing services/nutrition.ts must not load @ai-admin/core),
 * and a clean skip when no CADENCE_* env is configured.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { testUserId } from './test-user.ts';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

const HAS_DB = !!(process.env.CADENCE_DATABASE_URL || process.env.CADENCE_DB_PASSWORD);
const d = HAS_DB ? describe : describe.skip;

const USER = testUserId('a10d');

vi.mock('../ai/aim.ts', () => ({ runJob: vi.fn(), runJobBySlug: vi.fn() }));

let sql: (typeof import('../db/sql.ts'))['sql'];
let draft: typeof import('./meal-draft.ts');
let insertFood: (typeof import('../repos/foods.ts'))['insertFood'];
let insertRecipe: (typeof import('../repos/recipes.ts'))['insertRecipe'];
let findNutritionLog: (typeof import('../repos/nutrition.ts'))['findNutritionLog'];
let getNutritionDay: (typeof import('./nutrition.ts'))['getNutritionDay'];
let resetUserData: (typeof import('./dev-reset.ts'))['resetUserData'];

const today = (): string => new Date().toISOString().slice(0, 10);

/** One private food: `kcalPer100` per 100 g, one `serving` of `grams`. */
async function seedFood(name: string, kcalPer100: number, grams: number, unit = 'cup') {
  return insertFood(USER, {
    name,
    source: 'manual',
    base_unit: 'g',
    macros_per_base: { kcal: kcalPer100, protein_g: kcalPer100 / 20 },
    servings: [{ label: `1 ${unit} (${grams}g)`, unit, amount_g: grams }],
    default_serving: 0,
  });
}

d('meal draft lifecycle (DB)', () => {
  beforeAll(async () => {
    ({ sql } = await import('../db/sql.ts'));
    draft = await import('./meal-draft.ts');
    ({ insertFood } = await import('../repos/foods.ts'));
    ({ insertRecipe } = await import('../repos/recipes.ts'));
    ({ findNutritionLog } = await import('../repos/nutrition.ts'));
    ({ getNutritionDay } = await import('./nutrition.ts'));
    ({ resetUserData } = await import('./dev-reset.ts'));
  });

  afterAll(async () => {
    if (resetUserData) await resetUserData(USER);
    if (sql) await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetUserData(USER);
  });

  it('opens one draft per date+slot and rejoins it while the window is open', async () => {
    const first = await draft.openDraft(USER, { meal: 'breakfast', date: today() });
    expect(first.state).toBe('open');
    expect(first.items).toEqual([]);
    // The window is stated: ~3h out, visible on-surface.
    const msOut = Date.parse(first.closes_at!) - Date.now();
    expect(msOut).toBeGreaterThan(2.5 * 3600_000);
    expect(msOut).toBeLessThan(3.5 * 3600_000);

    const again = await draft.openDraft(USER, { meal: 'breakfast', date: today() });
    expect(again.log_id).toBe(first.log_id);

    const lunch = await draft.openDraft(USER, { meal: 'lunch', date: today() });
    expect(lunch.log_id).not.toBe(first.log_id);
  });

  it('appends foods at their serving and keeps a running total the day can read', async () => {
    const oats = await seedFood('zzq draft oats', 380, 80); // 304 kcal / serving
    const milk = await seedFood('zzq draft milk', 60, 250, 'glass'); // 150 kcal / serving
    const meal = await draft.openDraft(USER, { meal: 'breakfast', date: today() });

    await draft.appendFood(USER, meal.log_id, { food_id: oats.food_id });
    const after = await draft.appendFood(USER, meal.log_id, { food_id: milk.food_id });

    expect(after.items).toHaveLength(2);
    expect(after.items[0]).toMatchObject({ name: 'zzq draft oats', qty: 1, food_id: oats.food_id });
    expect(after.items[0]?.est?.kcal).toBeCloseTo(304, 0);
    expect(after.macros?.kcal).toBeCloseTo(454, 0);
    expect(after.state).toBe('open');
  });

  it('refuses a food nobody can see with a 404-shaped error', async () => {
    const meal = await draft.openDraft(USER, { meal: 'lunch', date: today() });
    await expect(
      draft.appendFood(USER, meal.log_id, { food_id: '00000000-0000-4000-a000-00000000beef' }),
    ).rejects.toThrow(/food not found/);
  });

  it('appends a recipe as a snapshot part, scaled to the servings logged', async () => {
    const recipe = await insertRecipe(USER, {
      name: 'zzq draft stew',
      source: 'user',
      servings: 2, // the yield
      ingredients: [
        { name: 'chickpeas', qty: 400, unit: 'g', est: { kcal: 200, protein_g: 12 } },
        { name: 'tomatoes', qty: 2, unit: 'cup', est: { kcal: 100 } },
      ],
      steps: [],
      macros_per_serving: { kcal: 150 },
      tags: [],
      saved: true,
    });
    const meal = await draft.openDraft(USER, { meal: 'dinner', date: today() });
    const after = await draft.appendRecipe(USER, meal.log_id, { recipe_id: recipe.recipe_id, servings: 1 });

    expect(after.parts).toHaveLength(1);
    const part = after.parts![0]!;
    expect(part).toMatchObject({
      name: 'zzq draft stew',
      recipe_id: recipe.recipe_id,
      yield_servings: 2,
      servings_logged: 1,
    });
    // Two member rows, each half the batch — one serving of a yield of two.
    expect(after.items).toHaveLength(2);
    expect(after.items.every((i) => i.part === part.key)).toBe(true);
    expect(after.items[0]?.est?.kcal).toBeCloseTo(100, 0);
    expect(after.items[0]?.qty).toBeCloseTo(200, 0);
    expect(after.items[1]?.est?.kcal).toBeCloseTo(50, 0);
    expect(after.macros?.kcal).toBeCloseTo(150, 0);
  });

  it('appends parsed rows verbatim — food_id and est survive, never re-parsed', async () => {
    const meal = await draft.openDraft(USER, { meal: 'lunch', date: today() });
    const foodId = '00000000-0000-4000-a000-00000000f00d';
    const after = await draft.appendParsed(USER, meal.log_id, [
      { name: 'zzq leftover soup', qty: 1, unit: 'bowl', est: { kcal: 312, protein_g: 9.6 }, food_id: foodId },
      { name: 'zzq roll', est: { kcal: 140 } },
    ]);
    expect(after.items).toHaveLength(2);
    expect(after.items[0]?.food_id).toBe(foodId);
    // The shared sanitizer's rounding (kcal → nearest 10, grams whole) — same as every confirm.
    expect(after.items[0]?.est?.kcal).toBe(310);
    expect(after.items[0]?.est?.protein_g).toBe(10);
    expect(after.macros?.kcal).toBeCloseTo(450, 0);
  });

  it('remove keeps an emptied draft open — only close/expiry deletes it', async () => {
    const oats = await seedFood('zzq draft oats', 380, 80);
    const meal = await draft.openDraft(USER, { meal: 'breakfast', date: today() });
    await draft.appendFood(USER, meal.log_id, { food_id: oats.food_id });

    const after = await draft.removeItem(USER, meal.log_id, 0);
    expect(after.items).toEqual([]);
    expect(after.state).toBe('open');
    expect(after.macros).toEqual({});
    expect(await findNutritionLog(USER, meal.log_id)).not.toBeNull();
  });

  it('remove fixes up part membership — a part left below two members dissolves', async () => {
    const recipe = await insertRecipe(USER, {
      name: 'zzq draft bowl',
      source: 'user',
      servings: 1,
      ingredients: [
        { name: 'chia', qty: 2, unit: 'tbsp', est: { kcal: 90 } },
        { name: 'milk', qty: 1, unit: 'cup', est: { kcal: 60 } },
      ],
      steps: [],
      macros_per_serving: { kcal: 150 },
      tags: [],
      saved: true,
    });
    const meal = await draft.openDraft(USER, { meal: 'breakfast', date: today() });
    await draft.appendRecipe(USER, meal.log_id, { recipe_id: recipe.recipe_id });

    const after = await draft.removeItem(USER, meal.log_id, 0);
    expect(after.items).toHaveLength(1);
    expect(after.items[0]?.part).toBeUndefined();
    expect(after.parts).toEqual([]);
  });

  it('rescales the estimate when the amount changes, like the client stepper', async () => {
    const oats = await seedFood('zzq draft oats', 380, 80);
    const meal = await draft.openDraft(USER, { meal: 'breakfast', date: today() });
    await draft.appendFood(USER, meal.log_id, { food_id: oats.food_id });

    const after = await draft.setAmount(USER, meal.log_id, 0, 2);
    expect(after.items[0]?.qty).toBe(2);
    expect(after.items[0]?.est?.kcal).toBeCloseTo(608, 0);
    expect(after.macros?.kcal).toBeCloseTo(608, 0);
  });

  it('moves the draft to another slot in one tap', async () => {
    const meal = await draft.openDraft(USER, { meal: 'snack', date: today() });
    const after = await draft.setSlot(USER, meal.log_id, 'lunch');
    expect(after.meal).toBe('lunch');
    expect(after.state).toBe('open');
  });

  it('close computes totals from the items, closes the row, and teaches food usage', async () => {
    const oats = await seedFood('zzq draft oats', 380, 80);
    const milk = await seedFood('zzq draft milk', 60, 250, 'glass');
    const meal = await draft.openDraft(USER, { meal: 'breakfast', date: today() });
    await draft.appendFood(USER, meal.log_id, { food_id: oats.food_id });
    await draft.appendFood(USER, meal.log_id, { food_id: milk.food_id });

    const closed = await draft.closeMeal(USER, meal.log_id);
    expect(closed?.state).toBe('closed');
    expect(closed?.macros?.kcal).toBeCloseTo(454, 0);

    const usage = await sql<{ n: string }[]>`
      select count(*)::text as n from cadence.food_usage where user_id = ${USER}`;
    expect(Number(usage[0]?.n)).toBe(2);

    // Closing again is a no-op that hands the row back, never a second commit.
    const again = await draft.closeMeal(USER, meal.log_id);
    expect(again?.log_id).toBe(meal.log_id);
    expect(again?.state).toBe('closed');
  });

  it('close of an empty draft deletes the row and returns null — no ghost diary row', async () => {
    const meal = await draft.openDraft(USER, { meal: 'snack', date: today() });
    expect(await draft.closeMeal(USER, meal.log_id)).toBeNull();
    expect(await findNutritionLog(USER, meal.log_id)).toBeNull();
  });

  it('expiry closes an overdue draft with items and dissolves an empty one', async () => {
    const oats = await seedFood('zzq draft oats', 380, 80);
    const fed = await draft.openDraft(USER, { meal: 'breakfast', date: today() });
    await draft.appendFood(USER, fed.log_id, { food_id: oats.food_id });
    const empty = await draft.openDraft(USER, { meal: 'lunch', date: today() });

    await sql`
      update cadence.nutrition_logs set closes_at = now() - interval '1 hour'
      where user_id = ${USER} and log_id in ${sql([fed.log_id, empty.log_id])}`;

    expect(await draft.getOpenMeal(USER)).toBeNull();
    const closed = await findNutritionLog(USER, fed.log_id);
    expect(closed?.state).toBe('closed');
    expect(closed?.macros?.kcal).toBeCloseTo(304, 0);
    expect(await findNutritionLog(USER, empty.log_id)).toBeNull();
  });

  it('the day read counts an open meal immediately, marked OPEN', async () => {
    const oats = await seedFood('zzq draft oats', 380, 80);
    const meal = await draft.openDraft(USER, { meal: 'breakfast', date: today() });
    await draft.appendFood(USER, meal.log_id, { food_id: oats.food_id });

    const day = await getNutritionDay(USER, today());
    expect(day.totals.kcal).toBeCloseTo(304, 0);
    const row = day.meals.find((m) => m.log_id === meal.log_id);
    expect(row?.state).toBe('open');
    expect(typeof row?.closes_at).toBe('string');
    expect(row?.parts).toEqual([]);
  });

  it('a mutation on a meal whose window ended is refused and the window is enforced', async () => {
    const oats = await seedFood('zzq draft oats', 380, 80);
    const meal = await draft.openDraft(USER, { meal: 'breakfast', date: today() });
    await draft.appendFood(USER, meal.log_id, { food_id: oats.food_id });
    await sql`
      update cadence.nutrition_logs set closes_at = now() - interval '1 minute'
      where user_id = ${USER} and log_id = ${meal.log_id}`;

    await expect(draft.appendFood(USER, meal.log_id, { food_id: oats.food_id })).rejects.toThrow(/not open/);
    // The touch itself enforced the clock: the meal is now honestly closed, food counted.
    expect((await findNutritionLog(USER, meal.log_id))?.state).toBe('closed');
  });
});
