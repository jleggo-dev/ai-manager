/**
 * P3 SWEEP-SERVER — detection (S3) against a real Cadence Postgres (HAS_DB pattern, per-process
 * test user). These pin the deterministic rails, as tests rather than comments:
 *   - a set must be seen on >= 3 distinct days — never once, never twice;
 *   - items already inside a bracket are not counted;
 *   - open drafts and out-of-window logs are invisible;
 *   - per-serving macros are summed from the items' own est — nothing is re-estimated.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import type { MealItem, MealKind } from '@cadence/shared';
import { testUserId } from './test-user.ts';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });
const HAS_DB = !!(process.env.CADENCE_DATABASE_URL || process.env.CADENCE_DB_PASSWORD);
const d = HAS_DB ? describe : describe.skip;

const USER = testUserId('f5d1');

// Lazily-bound module refs (populated in beforeAll so a no-DB env skips without importing config).
let sql: (typeof import('../db/sql.ts'))['sql'];
let insertNutritionLog: (typeof import('../repos/nutrition.ts'))['insertNutritionLog'];
let writeLogPartsAndItems: (typeof import('../repos/nutrition-sweep.ts'))['writeLogPartsAndItems'];
let detectSweepCandidates: (typeof import('./food-sweep-detect.ts'))['detectSweepCandidates'];
let resetUserData: (typeof import('./dev-reset.ts'))['resetUserData'];

const iso = (daysAgo: number): string => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

function item(foodId: string, name: string, kcal: number, qty = 1, unit = 'cup'): MealItem {
  return { name, qty, unit, food_id: foodId, est: { kcal, protein_g: 2 } };
}

const OATS = item('zzq-food-oats', 'oats', 150);
const CHIA = item('zzq-food-chia', 'chia seeds', 50, 2, 'tbsp');
const BERRIES = item('zzq-food-berries', 'blueberries', 80);
const COFFEE = item('zzq-food-coffee', 'coffee', 5);

async function seedMeal(daysAgo: number, meal: MealKind, items: MealItem[], rawText: string | null = null) {
  return insertNutritionLog(USER, {
    date: iso(daysAgo),
    meal,
    items,
    input_method: 'text',
    raw_text: rawText,
    macros: { kcal: items.reduce((n, i) => n + (i.est?.kcal ?? 0), 0) },
  });
}

d('food-sweep detection (S3)', () => {
  beforeAll(async () => {
    ({ sql } = await import('../db/sql.ts'));
    ({ insertNutritionLog } = await import('../repos/nutrition.ts'));
    ({ writeLogPartsAndItems } = await import('../repos/nutrition-sweep.ts'));
    ({ detectSweepCandidates } = await import('./food-sweep-detect.ts'));
    ({ resetUserData } = await import('./dev-reset.ts'));
  });

  afterAll(async () => {
    if (resetUserData) await resetUserData(USER);
    if (sql) await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetUserData(USER);
  });

  it('finds a set seen on three distinct days, with counts, amounts, fragments and summed macros', async () => {
    const l1 = await seedMeal(1, 'breakfast', [OATS, CHIA, BERRIES], 'my chia bowl again');
    const l2 = await seedMeal(2, 'breakfast', [OATS, CHIA, BERRIES], 'chia bowl');
    // The third day carries a passenger — the set still counts, the coffee stays outside.
    const l3 = await seedMeal(3, 'breakfast', [OATS, CHIA, BERRIES, COFFEE], 'chia bowl and a coffee');

    const found = await detectSweepCandidates(USER);
    expect(found).toHaveLength(1);
    const c = found[0]!;
    expect(c.slot).toBe('breakfast');
    expect(c.seen_count).toBe(3);
    expect(c.identical_meal_days).toBe(2); // day 3 had the extra coffee
    expect(c.members.map((m) => m.food_id).sort()).toEqual(
      [OATS.food_id, CHIA.food_id, BERRIES.food_id].sort() as string[],
    );
    // Modal amounts survive: chia keeps its 2 tbsp.
    expect(c.members.find((m) => m.food_id === CHIA.food_id)).toMatchObject({ qty: 2, unit: 'tbsp' });
    // Macros are the sum of the members' own est — the coffee (a non-member) contributes nothing.
    expect(c.macros_per_serving.kcal).toBe(150 + 50 + 80);
    expect(c.raw_fragments).toContain('chia bowl');
    expect(c.tidy_log_ids.sort()).toEqual([l1.log_id, l2.log_id, l3.log_id].sort());
  });

  it('never proposes a set seen once — or twice', async () => {
    await seedMeal(1, 'dinner', [item('zzq-food-steak', 'steak', 400), item('zzq-food-potato', 'potato', 200)]);
    await seedMeal(4, 'lunch', [item('zzq-food-soup', 'soup', 180), item('zzq-food-roll', 'roll', 120)]);
    await seedMeal(6, 'lunch', [item('zzq-food-soup', 'soup', 180), item('zzq-food-roll', 'roll', 120)]);
    expect(await detectSweepCandidates(USER)).toHaveLength(0);
  });

  it('does not count items already inside a bracket', async () => {
    for (const daysAgo of [1, 2, 3]) {
      const log = await seedMeal(daysAgo, 'lunch', [
        { ...item('zzq-food-tortilla', 'tortilla', 180), part: 'p1' },
        { ...item('zzq-food-chicken', 'chicken', 220), part: 'p1' },
      ]);
      await writeLogPartsAndItems(USER, log.log_id, [{ key: 'p1', name: 'wrap', source: 'user' }], log.items);
    }
    expect(await detectSweepCandidates(USER)).toHaveLength(0);
  });

  it('ignores open drafts and logs outside the 45-day window', async () => {
    // Two closed recent days + one open draft: support is 2, below the floor.
    await seedMeal(1, 'snack', [item('zzq-food-apple', 'apple', 90), item('zzq-food-pb', 'peanut butter', 190)]);
    await seedMeal(2, 'snack', [item('zzq-food-apple', 'apple', 90), item('zzq-food-pb', 'peanut butter', 190)]);
    const draft = await seedMeal(3, 'snack', [
      item('zzq-food-apple', 'apple', 90),
      item('zzq-food-pb', 'peanut butter', 190),
    ]);
    await sql`update cadence.nutrition_logs set state = 'open' where log_id = ${draft.log_id} and user_id = ${USER}`;
    // Three days of the same dinner, all older than the window.
    for (const daysAgo of [50, 52, 54]) {
      await seedMeal(daysAgo, 'dinner', [item('zzq-food-rice', 'rice', 200), item('zzq-food-dal', 'dal', 250)]);
    }
    expect(await detectSweepCandidates(USER)).toHaveLength(0);
  });
});
