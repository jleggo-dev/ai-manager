/**
 * A23 §1c — trigram search and the weekday/meal histogram, against a real Cadence Postgres.
 *
 * Both halves are SQL, so neither can be proven with a mock: the trigram operator either resolves
 * through the search_path or it does not, and `food_usage_ctx`'s FILTER aggregate either counts
 * the right slot or it does not. Skips cleanly with no CADENCE_* env, like every DB test here.
 *
 * Requires migration 0039 (`apply-migration-0039.ts`).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import type { Food } from '@cadence/shared';
import { testUserId } from './test-user.ts';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

const HAS_DB = !!(process.env.CADENCE_DATABASE_URL || process.env.CADENCE_DB_PASSWORD);
const d = HAS_DB ? describe : describe.skip;

const USER = testUserId('a106');

// No network: the resolver's USDA rung would otherwise fire on every miss in these tests.
vi.mock('./food-sources/usda-enrich.ts', () => ({
  enrichFoodsWithUsda: vi.fn(async (_u: string, _q: string, local: Food[]) => local),
  searchFoodsWithUsda: vi.fn(async () => []),
}));

let sql: (typeof import('../db/sql.ts'))['sql'];
let insertFood: (typeof import('../repos/foods.ts'))['insertFood'];
let searchFoods: (typeof import('../repos/foods.ts'))['searchFoods'];
let touchFoodUsage: (typeof import('../repos/foods.ts'))['touchFoodUsage'];
let listFoodContextRows: (typeof import('../repos/foods.ts'))['listFoodContextRows'];
let loadResolveShared: (typeof import('./food-resolver.ts'))['loadResolveShared'];
let rankedFoodsFor: (typeof import('./food-resolver.ts'))['rankedFoodsFor'];
let resetUserData: (typeof import('./dev-reset.ts'))['resetUserData'];

/** A minimal own food; the numbers do not matter to ranking. */
async function own(name: string, brand: string | null = null) {
  return insertFood(USER, {
    name,
    brand,
    source: 'manual',
    visibility: 'private',
    base_unit: 'item',
    macros_per_base: { kcal: 100 },
    servings: [{ label: '1 serving', unit: 'serving', amount_g: 1 }],
    default_serving: 0,
    confidence: 1,
  });
}

const WEDNESDAYS = ['2026-08-05', '2026-08-12', '2026-08-19']; // all dow 3
const WED = 3;

d('A23 §1c — search and rhythm (DB)', () => {
  beforeAll(async () => {
    ({ sql } = await import('../db/sql.ts'));
    ({ insertFood, searchFoods, touchFoodUsage, listFoodContextRows } = await import('../repos/foods.ts'));
    ({ loadResolveShared, rankedFoodsFor } = await import('./food-resolver.ts'));
    ({ resetUserData } = await import('./dev-reset.ts'));
  });

  afterAll(async () => {
    if (resetUserData) await resetUserData(USER);
    if (sql) await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetUserData(USER);
  });

  describe('trigram search', () => {
    /** Plain LIKE could never do this: the words are there, in the wrong order. */
    it('finds a food whose words are in a different order', async () => {
      await own('Yogurt, Greek, plain');
      const hits = await searchFoods(USER, 'greek yogurt');
      expect(hits.map((f) => f.name)).toContain('Yogurt, Greek, plain');
    });

    it('still finds a plain substring match', async () => {
      await own('Sourdough toast');
      expect((await searchFoods(USER, 'sourdough')).map((f) => f.name)).toContain('Sourdough toast');
    });

    it('survives a small misspelling', async () => {
      await own('Yogurt parfait');
      expect((await searchFoods(USER, 'yogurt parfat')).map((f) => f.name)).toContain('Yogurt parfait');
    });

    it('matches on brand as well as name', async () => {
      await own('Cold brew', 'Materia Prima');
      expect((await searchFoods(USER, 'materia prima')).map((f) => f.name)).toContain('Cold brew');
    });

    it('does not return unrelated foods', async () => {
      await own('Grilled salmon');
      await own('Yogurt parfait');
      expect((await searchFoods(USER, 'grilled salmon')).map((f) => f.name)).not.toContain('Yogurt parfait');
    });

    it('returns nothing for an empty query', async () => {
      await own('Yogurt parfait');
      expect(await searchFoods(USER, '   ')).toEqual([]);
    });
  });

  describe('the weekday + meal histogram', () => {
    it('counts the slot it was eaten in, and the meal across all days', async () => {
      const parfait = await own('Yogurt parfait', 'Materia Prima');
      const oats = await own('Porridge');
      for (const _ of WEDNESDAYS) await touchFoodUsage(USER, parfait.food_id, { dow: WED, meal: 'breakfast' });
      // Same meal, different days — the weaker signal.
      await touchFoodUsage(USER, oats.food_id, { dow: 1, meal: 'breakfast' });
      await touchFoodUsage(USER, oats.food_id, { dow: 2, meal: 'breakfast' });

      const rows = await listFoodContextRows(USER, { dow: WED, meal: 'breakfast' });
      const byId = new Map(rows.map((r) => [r.food_id, r]));
      expect(byId.get(parfait.food_id)).toMatchObject({ slot_count: WEDNESDAYS.length, meal_count: WEDNESDAYS.length });
      // Porridge is a breakfast food, but never on a Wednesday.
      expect(byId.get(oats.food_id)).toMatchObject({ slot_count: 0, meal_count: 2 });
    });

    it('keeps a food that is eaten at two different times apart', async () => {
      const food = await own('Yogurt parfait');
      await touchFoodUsage(USER, food.food_id, { dow: WED, meal: 'breakfast' });
      await touchFoodUsage(USER, food.food_id, { dow: WED, meal: 'snack' });

      const breakfast = await listFoodContextRows(USER, { dow: WED, meal: 'breakfast' });
      expect(breakfast.find((r) => r.food_id === food.food_id)?.slot_count).toBe(1);
      const rows = await sql<{ n: string }[]>`
        select count(*)::text as n from cadence.food_usage_ctx where user_id = ${USER}`;
      expect(Number(rows[0]?.n)).toBe(2);
    });

    it('ignores a slot it cannot use rather than writing a junk row', async () => {
      const food = await own('Yogurt parfait');
      await touchFoodUsage(USER, food.food_id, { dow: 9, meal: 'breakfast' });
      await touchFoodUsage(USER, food.food_id, { dow: WED, meal: '' });
      await touchFoodUsage(USER, food.food_id);
      const rows = await sql<{ n: string }[]>`
        select count(*)::text as n from cadence.food_usage_ctx where user_id = ${USER}`;
      expect(Number(rows[0]?.n)).toBe(0);
      // The plain usage projection still counted all three.
      const usage = await sql<{ c: number }[]>`
        select use_count as c from cadence.food_usage where user_id = ${USER} and food_id = ${food.food_id}`;
      expect(usage[0]?.c).toBe(3);
    });
  });

  /**
   * The whole point, end to end: two foods with the SAME name, one eaten only on Wednesdays. On a
   * Wednesday morning the café one has to be the answer — not one of two.
   */
  it('ranks the Wednesday food first on a Wednesday, and not on a Thursday', async () => {
    const cafe = await own('Yogurt parfait', 'Materia Prima');
    const home = await own('Yogurt parfait');
    for (const _ of WEDNESDAYS) await touchFoodUsage(USER, cafe.food_id, { dow: WED, meal: 'breakfast' });
    // The home one is eaten more overall, just never on a Wednesday morning.
    for (const dow of [0, 1, 2, 4, 5, 6]) await touchFoodUsage(USER, home.food_id, { dow, meal: 'breakfast' });

    const wed = await loadResolveShared(USER, { dow: WED, meal: 'breakfast' });
    const wedRanked = await rankedFoodsFor(USER, 'yogurt parfait', wed);
    expect(wedRanked[0]?.food.food_id).toBe(cafe.food_id);
    expect(wedRanked[0]!.score - wedRanked[1]!.score).toBeGreaterThanOrEqual(0.1);

    // Thursday: no Wednesday signal, so overall usage decides and the home one comes back.
    const thu = await loadResolveShared(USER, { dow: 4, meal: 'breakfast' });
    const thuRanked = await rankedFoodsFor(USER, 'yogurt parfait', thu);
    expect(thuRanked[0]?.food.food_id).toBe(home.food_id);
  });

  it('logging through the normal path teaches the rhythm', async () => {
    const { logMealFromFood } = await import('./nutrition-log-saved.ts');
    const food = await own('Yogurt parfait', 'Materia Prima');
    await logMealFromFood(USER, { food_id: food.food_id, meal: 'breakfast', date: '2026-08-19' });

    const rows = await listFoodContextRows(USER, { dow: WED, meal: 'breakfast' });
    expect(rows.find((r) => r.food_id === food.food_id)?.slot_count).toBe(1);
  });
});
