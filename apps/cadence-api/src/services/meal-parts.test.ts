/**
 * The bracket grammar. Two halves:
 *   - applyPartOp is pure, and the invariant that matters most — no op ever changes a number —
 *     is asserted around every single op.
 *   - the DB half proves ops land on open AND closed rows, that the stored macros column never
 *     moves, and that savePartAsRecipe is a true snapshot (editing the cookbook recipe
 *     afterwards reaches nothing).
 *
 * Whole file gated on HAS_DB like the sibling suites: meal-parts.ts imports the repo layer, and
 * importing config without CADENCE_* env throws before any pure function could run.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import type { NutritionLog } from '@cadence/shared';
import { testUserId } from './test-user.ts';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

const HAS_DB = !!(process.env.CADENCE_DATABASE_URL || process.env.CADENCE_DB_PASSWORD);
const d = HAS_DB ? describe : describe.skip;

const USER = testUserId('a10e');

let sql: (typeof import('../db/sql.ts'))['sql'];
let parts: typeof import('./meal-parts.ts');
let insertNutritionLog: (typeof import('../repos/nutrition.ts'))['insertNutritionLog'];
let findNutritionLog: (typeof import('../repos/nutrition.ts'))['findNutritionLog'];
let getRecipe: (typeof import('../repos/recipes.ts'))['getRecipe'];
let updateRecipe: (typeof import('../repos/recipes.ts'))['updateRecipe'];
let resetUserData: (typeof import('./dev-reset.ts'))['resetUserData'];

const today = (): string => new Date().toISOString().slice(0, 10);

const ITEMS: NutritionLog['items'] = [
  { name: 'chia pudding', qty: 1, unit: 'cup', est: { kcal: 100, protein_g: 4 }, food_id: '00000000-0000-4000-a000-00000000c41a' },
  { name: 'oat milk', qty: 1, unit: 'glass', est: { kcal: 50 } },
  { name: 'blueberries', qty: 1, unit: 'handful', est: { kcal: 30, vitamin_c_mg: 4 } },
];

/** The invariant the whole grammar hangs on: an op changes structure, never numbers. */
function estsOf(items: NutritionLog['items']): unknown[] {
  return items.map((i) => i.est ?? null);
}

d('applyPartOp — the bracket grammar (pure)', () => {
  beforeAll(async () => {
    parts = await import('./meal-parts.ts');
  });

  const fresh = () => ({ items: ITEMS.map((i) => ({ ...i })), parts: [] });

  it('group brackets the chosen rows and touches nothing else', () => {
    const before = fresh();
    const out = parts.applyPartOp(before, { op: 'group', item_indexes: [0, 1], name: 'chia bowl' });
    expect(out.parts).toHaveLength(1);
    expect(out.parts[0]).toMatchObject({ name: 'chia bowl', source: 'user' });
    const key = out.parts[0]!.key;
    expect(out.items[0]?.part).toBe(key);
    expect(out.items[1]?.part).toBe(key);
    expect(out.items[2]?.part).toBeUndefined();
    expect(estsOf(out.items)).toEqual(estsOf(ITEMS));
  });

  it('an unnamed group is legal — naming is skippable', () => {
    const out = parts.applyPartOp(fresh(), { op: 'group', item_indexes: [0, 2] });
    expect(out.parts[0]?.name).toBeNull();
  });

  it('refuses a group of one, a bad index, and re-bracketing (parts stay flat)', () => {
    expect(() => parts.applyPartOp(fresh(), { op: 'group', item_indexes: [0] })).toThrow(parts.PartOpError);
    expect(() => parts.applyPartOp(fresh(), { op: 'group', item_indexes: [0, 9] })).toThrow(parts.PartOpError);
    const grouped = parts.applyPartOp(fresh(), { op: 'group', item_indexes: [0, 1] });
    expect(() => parts.applyPartOp(grouped, { op: 'group', item_indexes: [1, 2] })).toThrow(
      /only belong to one part/,
    );
  });

  it('add joins a loose row; remove takes one out; the second-to-last out dissolves the bracket', () => {
    let shape = parts.applyPartOp(fresh(), { op: 'group', item_indexes: [0, 1] });
    const key = shape.parts[0]!.key;
    shape = parts.applyPartOp(shape, { op: 'add', part: key, index: 2 });
    expect(shape.items.every((i) => i.part === key)).toBe(true);

    shape = parts.applyPartOp(shape, { op: 'remove', part: key, index: 2 });
    expect(shape.parts).toHaveLength(1);
    expect(shape.items[2]?.part).toBeUndefined();

    // "A recipe of one item isn't a recipe."
    shape = parts.applyPartOp(shape, { op: 'remove', part: key, index: 1 });
    expect(shape.parts).toEqual([]);
    expect(shape.items.every((i) => i.part === undefined)).toBe(true);
    expect(estsOf(shape.items)).toEqual(estsOf(ITEMS));
  });

  it('ungroup never removes food from the day — same rows, read as loose things', () => {
    const grouped = parts.applyPartOp(fresh(), { op: 'group', item_indexes: [0, 1, 2] });
    const out = parts.applyPartOp(grouped, { op: 'ungroup', part: grouped.parts[0]!.key });
    expect(out.parts).toEqual([]);
    expect(out.items).toHaveLength(3);
    expect(estsOf(out.items)).toEqual(estsOf(ITEMS));
  });

  it('rename and set_yield change the read-back and only the read-back', () => {
    let shape = parts.applyPartOp(fresh(), { op: 'group', item_indexes: [0, 1] });
    const key = shape.parts[0]!.key;
    shape = parts.applyPartOp(shape, { op: 'rename', part: key, name: 'Chia bowl' });
    expect(shape.parts[0]?.name).toBe('Chia bowl');

    shape = parts.applyPartOp(shape, { op: 'set_yield', part: key, yield_servings: 4 });
    expect(shape.parts[0]?.yield_servings).toBe(4);
    // Defaults so yield × per-serving still equals what is on the plate.
    expect(shape.parts[0]?.servings_logged).toBe(4);

    shape = parts.applyPartOp(shape, { op: 'set_yield', part: key, yield_servings: 4, servings_logged: 1 });
    expect(shape.parts[0]?.servings_logged).toBe(1);
    expect(estsOf(shape.items)).toEqual(estsOf(ITEMS));
  });

  it('names a missing part honestly', () => {
    expect(() => parts.applyPartOp(fresh(), { op: 'ungroup', part: 'nope' })).toThrow(/no such part/);
  });
});

d('meal parts (DB) — open and closed rows, numbers never move', () => {
  beforeAll(async () => {
    ({ sql } = await import('../db/sql.ts'));
    parts = await import('./meal-parts.ts');
    ({ insertNutritionLog, findNutritionLog } = await import('../repos/nutrition.ts'));
    ({ getRecipe, updateRecipe } = await import('../repos/recipes.ts'));
    ({ resetUserData } = await import('./dev-reset.ts'));
  });

  afterAll(async () => {
    if (resetUserData) await resetUserData(USER);
    if (sql) await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetUserData(USER);
  });

  /** A logged (closed) meal exactly as the express writes leave one. */
  async function seedClosedMeal(): Promise<NutritionLog> {
    return insertNutritionLog(USER, {
      date: today(),
      meal: 'breakfast',
      items: ITEMS,
      input_method: 'manual',
      raw_text: 'chia pudding, oat milk, blueberries',
      flags: {},
      macros: { kcal: 180, protein_g: 4, vitamin_c_mg: 4 },
      provisional: false,
    });
  }

  it('groups on a CLOSED meal — grouping the past is legal and changes no numbers', async () => {
    const meal = await seedClosedMeal();
    expect(meal.state).toBe('closed');

    const row = await parts.editMealParts(USER, meal.log_id, { op: 'group', item_indexes: [0, 1], name: 'chia bowl' });
    expect(row.parts).toHaveLength(1);
    expect(row.items[0]?.part).toBe(row.parts![0]!.key);
    // The stored totals column is untouched, byte for byte.
    expect(row.macros).toEqual(meal.macros);
    expect(estsOf(row.items)).toEqual(estsOf(meal.items));

    const back = await parts.editMealParts(USER, meal.log_id, { op: 'ungroup', part: row.parts![0]!.key });
    expect(back.parts).toEqual([]);
    expect(back.macros).toEqual(meal.macros);
  });

  it('savePartAsRecipe snapshots the part — cookbook edits never reach backwards', async () => {
    const meal = await seedClosedMeal();
    const grouped = await parts.editMealParts(USER, meal.log_id, { op: 'group', item_indexes: [0, 1] });
    const key = grouped.parts![0]!.key;

    const { recipe, meal: named } = await parts.savePartAsRecipe(USER, meal.log_id, {
      part: key,
      name: 'Chia bowl',
      yield_servings: 2,
    });

    expect(recipe.source).toBe('user');
    expect(recipe.saved).toBe(true);
    expect(recipe.servings).toBe(2);
    // Part total (100 + 50) ÷ yield 2.
    expect(recipe.macros_per_serving.kcal).toBeCloseTo(75, 0);
    expect(recipe.ingredients).toHaveLength(2);
    expect(recipe.ingredients[0]).toMatchObject({
      name: 'chia pudding',
      qty: 1,
      unit: 'cup',
      food_id: '00000000-0000-4000-a000-00000000c41a',
    });
    expect(recipe.ingredients[0]?.est?.kcal).toBe(100);

    const part = named.parts!.find((p) => p.key === key)!;
    expect(part).toMatchObject({ name: 'Chia bowl', recipe_id: recipe.recipe_id, yield_servings: 2 });
    expect(named.macros).toEqual(meal.macros);

    // Now move the cookbook version on — the logged meal must not follow.
    await updateRecipe(USER, recipe.recipe_id, {
      ingredients: [{ name: 'entirely different thing', qty: 9, est: { kcal: 900 } }],
      macros_per_serving: { kcal: 900 },
    });
    expect((await getRecipe(USER, recipe.recipe_id))?.macros_per_serving.kcal).toBe(900);

    const after = await findNutritionLog(USER, meal.log_id);
    expect(after?.macros).toEqual(meal.macros);
    expect(estsOf(after?.items ?? [])).toEqual(estsOf(meal.items));
    expect(after?.parts!.find((p) => p.key === key)?.name).toBe('Chia bowl');
  });

  it('every op leaves the macros column identical on an OPEN meal too', async () => {
    const meal = await insertNutritionLog(USER, {
      date: today(),
      meal: 'lunch',
      items: ITEMS,
      input_method: 'manual',
      flags: {},
      macros: { kcal: 180 },
      provisional: false,
      parts: [],
      state: 'open',
      closes_at: new Date(Date.now() + 3600_000).toISOString(),
    });

    let row = await parts.editMealParts(USER, meal.log_id, { op: 'group', item_indexes: [0, 1] });
    const key = row.parts![0]!.key;
    for (const op of [
      { op: 'rename', part: key, name: 'lunch bowl' },
      { op: 'set_yield', part: key, yield_servings: 3 },
      { op: 'add', part: key, index: 2 },
      { op: 'remove', part: key, index: 2 },
    ] as const) {
      row = await parts.editMealParts(USER, meal.log_id, op);
      expect(row.macros).toEqual(meal.macros);
      expect(estsOf(row.items)).toEqual(estsOf(meal.items));
    }
    expect(row.state).toBe('open');
  });
});
