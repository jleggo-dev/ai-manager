/**
 * Parts — the bracket (meal-logging rework, 2026-09-02). A meal contains items and parts, nothing
 * else; there is no "group" object. Every op here is pure part+items math plus ONE repo write, and
 * the grammar is enforced at this seam:
 *
 *   - Parts are flat by construction: an item carries at most one `part` key, a `group`/`add` op
 *     refuses an item that is already bracketed, and no op can put a part inside a part.
 *   - A part with fewer than two members dissolves on its own — a recipe of one item isn't a
 *     recipe (the append-recipe snapshot is the deliberate exception; see meal-draft.ts).
 *   - No op EVER touches the meal's numbers. Grouping only changes how the day reads back, so
 *     `items[].est` and the stored `macros` pass through every op byte-identical.
 *
 * Ops work on open AND closed meals — grouping the past is legal.
 */
import { randomUUID } from 'node:crypto';
import type { MealPart, NutritionLog, Recipe } from '@cadence/shared';
import { findNutritionLog, updateNutritionLog } from '../repos/nutrition.ts';
import { insertRecipe } from '../repos/recipes.ts';
import { computeMacrosPerServing } from './recipe-macros.ts';

/** A grammar violation or bad reference — the route answers 400, not 500. */
export class PartOpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PartOpError';
  }
}

/** Mirrors the client's MealPartOp union (lib/api/meal-draft.ts) — the wire shape of PATCH /parts. */
export type MealPartOp =
  | { op: 'group'; item_indexes: number[]; name?: string | null }
  | { op: 'ungroup'; part: string }
  | { op: 'rename'; part: string; name: string }
  | { op: 'set_yield'; part: string; yield_servings: number; servings_logged?: number }
  | { op: 'add'; part: string; index: number }
  | { op: 'remove'; part: string; index: number };

export interface PartsShape {
  items: NutritionLog['items'];
  parts: MealPart[];
}

/** A short key that is stable within this log and never collides across ops on it. */
export function newPartKey(): string {
  return randomUUID().slice(0, 8);
}

const clearPart = (item: NutritionLog['items'][number]): NutritionLog['items'][number] => {
  const { part: _part, ...rest } = item;
  return rest;
};

/**
 * Drop every part left with fewer than two members and clear the survivors' `part` field.
 * Ungrouping never removes food from the day — the members stay, read as loose things.
 */
export function dissolveThinParts(items: NutritionLog['items'], parts: MealPart[]): PartsShape {
  const thin = new Set(
    parts.filter((p) => items.filter((i) => i.part === p.key).length < 2).map((p) => p.key),
  );
  if (thin.size === 0) return { items, parts };
  return {
    items: items.map((i) => (i.part && thin.has(i.part) ? clearPart(i) : i)),
    parts: parts.filter((p) => !thin.has(p.key)),
  };
}

function requireIndex(items: NutritionLog['items'], index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= items.length) {
    throw new PartOpError('index is not an item on this meal');
  }
}

function requirePart(parts: MealPart[], key: string): MealPart {
  const part = parts.find((p) => p.key === key);
  if (!part) throw new PartOpError('no such part on this meal');
  return part;
}

/** Pure op application. Throws PartOpError on any grammar violation; never touches est/macros. */
export function applyPartOp(shape: PartsShape, op: MealPartOp): PartsShape {
  const items = [...shape.items];
  let parts = [...shape.parts];

  if (op.op === 'group') {
    const indexes = [...new Set(op.item_indexes)];
    if (indexes.length < 2) throw new PartOpError('a part needs at least two items');
    for (const i of indexes) {
      requireIndex(items, i);
      // Flat by construction: bracketing something already bracketed would nest or steal.
      if (items[i]!.part) throw new PartOpError('an item can only belong to one part');
    }
    const key = newPartKey();
    const name = typeof op.name === 'string' && op.name.trim() ? op.name.trim().slice(0, 120) : null;
    parts.push({ key, name, source: 'user' });
    for (const i of indexes) items[i] = { ...items[i]!, part: key };
    return { items, parts };
  }

  if (op.op === 'ungroup') {
    const part = requirePart(parts, op.part);
    return {
      items: items.map((i) => (i.part === part.key ? clearPart(i) : i)),
      parts: parts.filter((p) => p.key !== part.key),
    };
  }

  if (op.op === 'rename') {
    const part = requirePart(parts, op.part);
    const name = op.name.trim().slice(0, 120);
    if (!name) throw new PartOpError('a rename needs a name');
    parts = parts.map((p) => (p.key === part.key ? { ...p, name } : p));
    return { items, parts };
  }

  if (op.op === 'set_yield') {
    const part = requirePart(parts, op.part);
    if (!Number.isInteger(op.yield_servings) || op.yield_servings < 1) {
      throw new PartOpError('yield_servings must be a whole number of servings');
    }
    // Display-only, per the ruling: "it makes several portions" changes how the diary reads
    // ("1 of 4 servings"), never what the day counts. servings_logged defaults so that
    // yield × per-serving still equals what is on the plate.
    const servings_logged =
      typeof op.servings_logged === 'number' && op.servings_logged > 0
        ? op.servings_logged
        : (part.servings_logged ?? op.yield_servings);
    parts = parts.map((p) => (p.key === part.key ? { ...p, yield_servings: op.yield_servings, servings_logged } : p));
    return { items, parts };
  }

  if (op.op === 'add') {
    const part = requirePart(parts, op.part);
    requireIndex(items, op.index);
    if (items[op.index]!.part) throw new PartOpError('an item can only belong to one part');
    items[op.index] = { ...items[op.index]!, part: part.key };
    return { items, parts };
  }

  // op === 'remove'
  const part = requirePart(parts, op.part);
  requireIndex(items, op.index);
  if (items[op.index]!.part !== part.key) throw new PartOpError('that item is not in this part');
  items[op.index] = clearPart(items[op.index]!);
  return dissolveThinParts(items, parts);
}

/**
 * All bracket edits, one door (PATCH /nutrition/meals/:id/parts). Reads the meal, applies the op
 * in memory, writes items+parts back — and ONLY items+parts, so the stored macros cannot move.
 */
export async function editMealParts(userId: string, logId: string, op: MealPartOp): Promise<NutritionLog> {
  const meal = await findNutritionLog(userId, logId);
  if (!meal) throw new Error('meal not found');
  const next = applyPartOp({ items: meal.items ?? [], parts: meal.parts ?? [] }, op);
  const row = await updateNutritionLog(userId, logId, { items: next.items, parts: next.parts });
  if (!row) throw new Error('meal not found');
  return row;
}

/**
 * Name a part into the cookbook — naming and saving are the same act ("What do you call this?").
 *
 * The recipe is built from the part's OWN items, so it is a snapshot the moment it is born:
 * editing the cookbook recipe afterwards never reaches back into this or any logged meal.
 * macros_per_serving = the part's total ÷ yield, the same division every recipe save uses.
 */
export async function savePartAsRecipe(
  userId: string,
  logId: string,
  input: { part: string; name: string; yield_servings?: number },
): Promise<{ recipe: Recipe; meal: NutritionLog }> {
  const meal = await findNutritionLog(userId, logId);
  if (!meal) throw new Error('meal not found');
  const parts = meal.parts ?? [];
  const part = requirePart(parts, input.part);
  const members = (meal.items ?? []).filter((i) => i.part === part.key);
  if (members.length === 0) throw new PartOpError('that part has no items');

  const name = input.name.trim().slice(0, 120);
  if (!name) throw new PartOpError('a recipe needs a name');
  const yieldServings =
    Number.isInteger(input.yield_servings) && (input.yield_servings as number) >= 1
      ? (input.yield_servings as number)
      : (part.yield_servings ?? 1);

  const recipe = await insertRecipe(userId, {
    name,
    source: 'user',
    servings: yieldServings,
    ingredients: members.map((m) => ({
      name: m.name,
      qty: m.qty ?? 1,
      ...(m.unit ? { unit: m.unit } : {}),
      ...(m.food_id ? { food_id: m.food_id } : {}),
      ...(m.est ? { est: m.est } : {}),
    })),
    steps: [],
    macros_per_serving: computeMacrosPerServing(
      members.map((m) => m.est ?? {}),
      yieldServings,
    ),
    tags: [],
    saved: true,
  });

  const nextParts = parts.map((p) =>
    p.key === part.key
      ? {
          ...p,
          name,
          recipe_id: recipe.recipe_id,
          yield_servings: yieldServings,
          servings_logged: p.servings_logged ?? yieldServings,
        }
      : p,
  );
  const row = await updateNutritionLog(userId, logId, { parts: nextParts });
  if (!row) throw new Error('meal not found');
  return { recipe, meal: row };
}
