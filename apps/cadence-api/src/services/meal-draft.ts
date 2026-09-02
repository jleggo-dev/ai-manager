/**
 * The draft meal lifecycle (meal-logging rework 1b, 2026-09-02) — the meal is the unit of the
 * write, and a meal is a window, not a transaction.
 *
 * A draft opens (idempotently per date+slot), accepts adds for a visible 3-hour window, and then
 * closes — by the user's tap or lazily when a read finds the window over. While open it already
 * counts toward the day, marked OPEN; an abandoned EMPTY draft is deleted at expiry and leaves no
 * trace. The express writes (logMeal / logMealFromFood / logMealFromItems / logMealFromRecipe)
 * are untouched: they stay the one-shot closed writes.
 *
 * Numbers: every mutation recomputes the meal's macros as the sum of item estimates
 * (`sumItemNutrients`, micros included) — the same arithmetic the pricing path already uses —
 * so an open meal's total is always exactly what its rows say.
 */
import { isMacrosSource, type Macros, type MealKind, type NutritionLog } from '@cadence/shared';
import {
  deleteNutritionLog,
  findNutritionLog,
  findOpenMeal,
  findOpenMealForSlot,
  insertNutritionLog,
  listOverdueOpenMeals,
  updateNutritionLog,
} from '../repos/nutrition.ts';
import { getFood, touchFoodUsage } from '../repos/foods.ts';
import { getRecipe } from '../repos/recipes.ts';
import {
  findPendingFoodLogOccurrence,
  findPendingMealOccurrence,
  setOccurrenceStatus,
} from '../repos/occurrences.ts';
import { composePlate } from './plate-compose.ts';
import { sumItemNutrients } from './food-pricing.ts';
import { isMeal, usageSlot } from './nutrition-parse.ts';
import { sanitizeMacros } from './nutrition-day.ts';
import { scaleMacros } from './recipe-macros.ts';
import { dissolveThinParts, newPartKey } from './meal-parts.ts';

/** How long a meal accepts adds — visible on-surface as "adds until HH:MM", never a silent rule. */
export const DRAFT_WINDOW_MS = 3 * 60 * 60 * 1000;

const utcToday = (): string => new Date().toISOString().slice(0, 10);

/** The user's own calendar date when the request said where they are; UTC otherwise. */
export function localDate(tz?: string | null): string {
  if (!tz) return utcToday();
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return utcToday();
  }
}

/**
 * The header chip's default, inferred from the clock — asked once, changeable in one tap
 * (setSlot). A default only: an explicit `meal` from the client always wins.
 */
export function inferMealKind(tz?: string | null): MealKind {
  let hour = new Date().getUTCHours();
  if (tz) {
    try {
      hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date()));
    } catch {
      /* fall back to UTC */
    }
  }
  if (hour >= 4 && hour <= 10) return 'breakfast';
  if (hour >= 11 && hour <= 14) return 'lunch';
  if (hour >= 17 && hour <= 21) return 'dinner';
  return 'snack';
}

/** Same fallback ladder the express writes use: the per-meal task first, then the single row. */
async function tickFoodLogOccurrence(userId: string, date: string, meal?: string): Promise<void> {
  try {
    const occId =
      (meal ? await findPendingMealOccurrence(userId, date, meal) : null) ??
      (await findPendingFoodLogOccurrence(userId, date));
    if (occId) await setOccurrenceStatus(userId, occId, 'done');
  } catch (e) {
    console.warn('[meal-draft] meal-log occurrence tick failed:', e);
  }
}

/** Closing side effects, shared by the tap and the lazy expiry: totals, occurrence, usage. */
async function closeMealRow(userId: string, meal: NutritionLog): Promise<NutritionLog> {
  const macros = sumItemNutrients(meal.items ?? []) ?? {};
  const row = await updateNutritionLog(userId, meal.log_id, { state: 'closed', macros });
  await tickFoodLogOccurrence(userId, meal.date, meal.meal);
  for (const item of meal.items ?? []) {
    if (!item.food_id) continue;
    try {
      await touchFoodUsage(userId, item.food_id, usageSlot(meal.date, meal.meal));
    } catch (e) {
      console.warn('[meal-draft] food_usage touch failed:', e);
    }
  }
  return row ?? { ...meal, state: 'closed', macros };
}

/**
 * Close (or, when empty, delete) every open meal whose window has ended. Called lazily from the
 * reads and from openDraft — there is no cron; the next look at the day enforces the clock.
 */
export async function expireOverdueMeals(userId: string): Promise<void> {
  const overdue = await listOverdueOpenMeals(userId);
  for (const meal of overdue) {
    if ((meal.items ?? []).length === 0) await deleteNutritionLog(userId, meal.log_id);
    else await closeMealRow(userId, meal);
  }
}

/**
 * Open (or rejoin) the draft for a slot — idempotent per (date, meal): while a draft for that
 * slot is inside its window, the same one comes back, which is how the 09:40 latte joins
 * breakfast instead of becoming an orphan snack.
 */
export async function openDraft(
  userId: string,
  input: { meal?: MealKind; date?: string },
  tz?: string | null,
): Promise<NutritionLog> {
  await expireOverdueMeals(userId);
  const date = input.date ?? localDate(tz);
  const meal: MealKind = input.meal && isMeal(input.meal) ? input.meal : inferMealKind(tz);
  const existing = await findOpenMealForSlot(userId, date, meal);
  if (existing) return existing;
  return insertNutritionLog(userId, {
    date,
    meal,
    items: [],
    input_method: 'manual',
    ai_confidence: null,
    raw_text: null,
    flags: {},
    photo_ref: null,
    macros: {},
    provisional: false,
    parts: [],
    state: 'open',
    closes_at: new Date(Date.now() + DRAFT_WINDOW_MS).toISOString(),
  });
}

/** The one open meal, if any — how a reopened app finds its way back into breakfast. */
export async function getOpenMeal(userId: string): Promise<NutritionLog | null> {
  await expireOverdueMeals(userId);
  return findOpenMeal(userId);
}

async function requireMeal(userId: string, logId: string): Promise<NutritionLog> {
  const meal = await findNutritionLog(userId, logId);
  if (!meal) throw new Error('meal not found');
  return meal;
}

/**
 * A draft mutation needs a meal that is still accepting adds. A meal whose window ended but
 * which no read has expired yet is expired right here — the window is a rule about time, not
 * about who happened to look first. Later food starts a new meal.
 */
async function requireOpenMeal(userId: string, logId: string): Promise<NutritionLog> {
  const meal = await requireMeal(userId, logId);
  if (meal.state !== 'open') throw new Error('meal is not open');
  if (meal.closes_at && Date.parse(meal.closes_at) < Date.now()) {
    if ((meal.items ?? []).length === 0) await deleteNutritionLog(userId, meal.log_id);
    else await closeMealRow(userId, meal);
    throw new Error('meal is not open');
  }
  return meal;
}

/** Write items(+parts) and the recomputed running total. `{}` macros = an honest empty draft. */
async function writeItems(
  userId: string,
  logId: string,
  items: NutritionLog['items'],
  parts: NutritionLog['parts'],
): Promise<NutritionLog> {
  const macros: Macros = sumItemNutrients(items) ?? {};
  const row = await updateNutritionLog(userId, logId, { items, parts: parts ?? [], macros });
  if (!row) throw new Error('meal not found');
  return row;
}

/** Append one resolved food at a serving — the ＋ on a search/recents row (B2). */
export async function appendFood(
  userId: string,
  logId: string,
  input: { food_id: string; serving_index?: number; quantity?: number },
): Promise<NutritionLog> {
  const meal = await requireOpenMeal(userId, logId);
  const food = await getFood(userId, input.food_id);
  if (!food) throw new Error('food not found');
  // The same serving math the plate write uses — one item composed, then appended.
  const { items: composed } = composePlate([food], [{ serving_index: input.serving_index, quantity: input.quantity }]);
  return writeItems(userId, meal.log_id, [...(meal.items ?? []), ...composed], meal.parts);
}

/**
 * Append a cookbook recipe as a part (the bracket). The part's items are a SNAPSHOT of the
 * recipe's ingredients scaled to `servings` of its yield — cookbook edits never reach backwards.
 */
export async function appendRecipe(
  userId: string,
  logId: string,
  input: { recipe_id: string; servings?: number },
): Promise<NutritionLog> {
  const meal = await requireOpenMeal(userId, logId);
  const recipe = await getRecipe(userId, input.recipe_id);
  if (!recipe) throw new Error('recipe not found');
  const servingsLogged = input.servings && input.servings > 0 ? input.servings : 1;
  const yieldServings = Number.isFinite(recipe.servings) && recipe.servings > 0 ? recipe.servings : 1;
  const factor = servingsLogged / yieldServings;
  const key = newPartKey();

  let members: NutritionLog['items'] = recipe.ingredients.slice(0, 20).map((ing) => ({
    name: ing.name,
    ...(typeof ing.qty === 'number' && ing.qty > 0 ? { qty: Math.round(ing.qty * factor * 100) / 100 } : {}),
    ...(ing.unit ? { unit: ing.unit } : {}),
    ...(ing.est && Object.keys(ing.est).length ? { est: scaleMacros(ing.est, factor) } : {}),
    ...(ing.food_id ? { food_id: ing.food_id } : {}),
    part: key,
  }));
  // A recipe whose ingredients carry no numbers at all would put an uncounted bracket on the day.
  // Fall back to one summary row priced from macros_per_serving — honest total, thinner snapshot.
  const counted = members.some((m) => m.est && Object.keys(m.est).length > 0);
  if (members.length === 0 || (!counted && Object.keys(recipe.macros_per_serving ?? {}).length > 0)) {
    members = [
      {
        name: recipe.name,
        qty: servingsLogged,
        unit: 'serving',
        est: scaleMacros(recipe.macros_per_serving ?? {}, servingsLogged),
        part: key,
      },
    ];
  }

  const part = {
    key,
    name: recipe.name,
    recipe_id: recipe.recipe_id,
    yield_servings: yieldServings,
    servings_logged: servingsLogged,
    source: 'user' as const,
  };
  return writeItems(userId, meal.log_id, [...(meal.items ?? []), ...members], [...(meal.parts ?? []), part]);
}

export interface ParsedDraftItem {
  name: string;
  brand?: string;
  qty?: number;
  unit?: string;
  est?: object;
  food_id?: string;
}

/**
 * Append rows a parser already produced (the chat/voice/photo doors) — passed through verbatim,
 * never re-parsed. Resolved rows keep their food_id and est; numbers only pass the same
 * sanitizer every client-supplied estimate passes.
 */
export async function appendParsed(userId: string, logId: string, parsed: ParsedDraftItem[]): Promise<NutritionLog> {
  const meal = await requireOpenMeal(userId, logId);
  const appended: NutritionLog['items'] = parsed
    .filter((i) => i && typeof i.name === 'string' && i.name.trim())
    .slice(0, 20)
    .map((i) => {
      const est = sanitizeMacros(i.est);
      const source = (i.est as Macros | undefined)?.source;
      return {
        name: i.name.trim(),
        ...(i.brand?.trim() ? { brand: i.brand.trim() } : {}),
        ...(typeof i.qty === 'number' && i.qty > 0 ? { qty: i.qty } : {}),
        ...(i.unit?.trim() ? { unit: i.unit.trim() } : {}),
        ...(est ? { est: { ...est, ...(isMacrosSource(source) ? { source } : {}) } } : {}),
        ...(i.food_id ? { food_id: i.food_id } : {}),
      };
    });
  return writeItems(userId, meal.log_id, [...(meal.items ?? []), ...appended], meal.parts);
}

/**
 * Take an item back out (the strip's Undo, a row's ×). Part membership is fixed up — a part left
 * below two members dissolves — and an emptied draft STAYS open: only close/expiry deletes it.
 */
export async function removeItem(userId: string, logId: string, index: number): Promise<NutritionLog> {
  const meal = await requireOpenMeal(userId, logId);
  const items = meal.items ?? [];
  if (!Number.isInteger(index) || index < 0 || index >= items.length) {
    throw new Error('index is not an item on this meal');
  }
  const next = dissolveThinParts(
    items.filter((_, i) => i !== index),
    meal.parts ?? [],
  );
  return writeItems(userId, meal.log_id, next.items, next.parts);
}

/** The stepper's server half: the same proportional rounding features/food/amounts.ts applies. */
export function scaleEstForAmount(est: Macros | undefined, factor: number): Macros | undefined {
  if (!est || !Number.isFinite(factor) || factor === 1) return est;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(est)) out[k] = typeof v === 'number' ? Math.round(v * factor * 10) / 10 : v;
  return out as Macros;
}

/** A stepper nudge — set one item's quantity; its estimate rescales proportionally. */
export async function setAmount(userId: string, logId: string, index: number, qty: number): Promise<NutritionLog> {
  const meal = await requireOpenMeal(userId, logId);
  const items = [...(meal.items ?? [])];
  if (!Number.isInteger(index) || index < 0 || index >= items.length) {
    throw new Error('index is not an item on this meal');
  }
  if (!(qty > 0)) throw new Error('qty must be a positive amount');
  const item = items[index]!;
  const prev = typeof item.qty === 'number' && item.qty > 0 ? item.qty : 1;
  const est = scaleEstForAmount(item.est, qty / prev);
  items[index] = { ...item, qty, ...(est ? { est } : {}) };
  return writeItems(userId, meal.log_id, items, meal.parts);
}

/** Move the draft to another slot — the header chip, asked once, changeable in one tap. */
export async function setSlot(userId: string, logId: string, meal: MealKind): Promise<NutritionLog> {
  const row = await requireOpenMeal(userId, logId);
  const out = await updateNutritionLog(userId, row.log_id, { meal });
  if (!out) throw new Error('meal not found');
  return out;
}

/**
 * Close the meal — the commit. Totals are recomputed from the items, the meal occurrence ticks,
 * and every ledger-linked item teaches recents/frequents. An empty draft closes to nothing:
 * the row is deleted and null comes back — no ghost diary row, nothing for the coach to see.
 * Closing an already-closed meal returns it unchanged.
 */
export async function closeMeal(userId: string, logId: string): Promise<NutritionLog | null> {
  const meal = await requireMeal(userId, logId);
  if (meal.state !== 'open') return meal;
  if ((meal.items ?? []).length === 0) {
    await deleteNutritionLog(userId, meal.log_id);
    return null;
  }
  return closeMealRow(userId, meal);
}
