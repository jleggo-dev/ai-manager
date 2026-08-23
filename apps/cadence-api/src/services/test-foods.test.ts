/**
 * The shared-cache cleaner. Its whole value is in what it REFUSES to delete: `food_usage` cascades
 * off `food_id`, so removing a food someone has actually eaten would take their rhythm history
 * (A23 §1c) with it. These pin that it only ever removes rows that cost nothing to lose.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { testUserId } from './test-user.ts';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

const HAS_DB = !!(process.env.CADENCE_DATABASE_URL || process.env.CADENCE_DB_PASSWORD);
const d = HAS_DB ? describe : describe.skip;

const USER = testUserId('a110');
/** Distinctive enough that no real cached food can collide with these tests. */
const NAME = 'Zzq Test Latte';

vi.mock('../ai/aim.ts', () => ({ runJob: vi.fn(), runJobBySlug: vi.fn() }));

let sql: (typeof import('../db/sql.ts'))['sql'];
let clearUnusedSharedFoods: (typeof import('./test-foods.ts'))['clearUnusedSharedFoods'];
let touchFoodUsage: (typeof import('../repos/foods.ts'))['touchFoodUsage'];
let resetUserData: (typeof import('./dev-reset.ts'))['resetUserData'];

/** A shared cache row, exactly as USDA/OFF/FatSecret imports create them. */
async function seedShared(name = NAME): Promise<string> {
  const [row] = await sql<{ food_id: string }[]>`
    insert into cadence.foods (owner_user_id, visibility, name, source, base_unit,
                               macros_per_base, servings, default_serving, confidence)
    values (null, 'shared', ${name}, 'usda', 'g', '{"kcal":100}'::jsonb,
            '[{"label":"100 g","unit":"g","amount_g":100}]'::jsonb, 0, 1)
    returning food_id`;
  return row!.food_id;
}

d('clearUnusedSharedFoods (DB)', () => {
  beforeAll(async () => {
    ({ sql } = await import('../db/sql.ts'));
    ({ clearUnusedSharedFoods } = await import('./test-foods.ts'));
    ({ touchFoodUsage } = await import('../repos/foods.ts'));
    ({ resetUserData } = await import('./dev-reset.ts'));
  });

  afterAll(async () => {
    if (resetUserData) await resetUserData(USER);
    if (sql) await sql`delete from cadence.foods where name like 'Zzq Test%'`;
    if (sql) await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetUserData(USER);
    await sql`delete from cadence.foods where name like 'Zzq Test%'`;
  });

  /** The exact collision that broke the ledger suite on 2026-08-23. */
  it('removes an unused shared row that would answer a query meant to miss', async () => {
    const id = await seedShared();
    expect(await clearUnusedSharedFoods(['zzq test latte'])).toBe(1);
    const left = await sql<{ n: string }[]>`
      select count(*)::text as n from cadence.foods where food_id = ${id}`;
    expect(Number(left[0]?.n)).toBe(0);
  });

  /**
   * THE GUARD. A food someone has eaten carries their rhythm history through a cascading FK —
   * deleting it to tidy a test would take real data with it.
   */
  it('refuses to remove a food somebody has actually eaten', async () => {
    const id = await seedShared();
    await touchFoodUsage(USER, id, { dow: 3, meal: 'breakfast' });

    expect(await clearUnusedSharedFoods(['zzq test latte'])).toBe(0);
    const usage = await sql<{ n: string }[]>`
      select count(*)::text as n from cadence.food_usage where food_id = ${id}`;
    expect(Number(usage[0]?.n)).toBe(1);
  });

  it('refuses to remove a food a logged meal points at', async () => {
    const id = await seedShared();
    const { insertNutritionLog } = await import('../repos/nutrition.ts');
    await insertNutritionLog(USER, {
      date: new Date().toISOString().slice(0, 10),
      meal: 'breakfast',
      items: [{ name: NAME, food_id: id }],
      input_method: 'text',
      raw_text: NAME,
      macros: { kcal: 100 },
      provisional: false,
    });

    expect(await clearUnusedSharedFoods(['zzq test latte'])).toBe(0);
  });

  it('never touches a food somebody owns', async () => {
    const { insertFood } = await import('../repos/foods.ts');
    const own = await insertFood(USER, {
      name: NAME,
      source: 'llm',
      visibility: 'private',
      base_unit: 'item',
      macros_per_base: { kcal: 100 },
      servings: [{ label: '1', unit: 'serving', amount_g: 1 }],
      default_serving: 0,
      confidence: 1,
    });
    expect(await clearUnusedSharedFoods(['zzq test latte'])).toBe(0);
    const left = await sql<{ n: string }[]>`
      select count(*)::text as n from cadence.foods where food_id = ${own.food_id}`;
    expect(Number(left[0]?.n)).toBe(1);
  });

  it('ignores patterns too short to be a name, so it cannot wildcard the cache away', async () => {
    await seedShared();
    expect(await clearUnusedSharedFoods([''])).toBe(0);
    expect(await clearUnusedSharedFoods(['a'])).toBe(0);
    expect(await clearUnusedSharedFoods([])).toBe(0);
  });
});
