/**
 * Req 5 Phase 5 — meal plans + shopping list client (Food tab).
 *
 * Routes (soft-fail on 404/network):
 *   GET    /nutrition/meal-plans[?week_of=]
 *   GET    /nutrition/meal-plans/:id
 *   POST   /nutrition/meal-plans/generate  body: { week_of, prefs?, … }
 *   POST   /nutrition/meal-plans           confirm-path save (nested recipe drafts)
 *   PATCH  /nutrition/meal-plans/:id       shopping_list / days / notes
 *
 * Discovery (UI only when probe says the route exists):
 *   POST   /nutrition/recipes/discover     → RecipeDraft[] (confirm via saveRecipe)
 */

import type { MealPlan, MealPlanDay, MealPlanItem, MealPlanMeal, ShoppingListItem } from '@cadence/shared';
import { BASE, headers } from './http.ts';
import type { ApiAvailability } from './foods.ts';
import { parseRecipeDraft, type RecipeDraft } from './recipes.ts';

/** Alias for shared MealPlan — Food-tab panels import from the API barrel. */
export type MealPlanRecord = MealPlan;
export type { MealPlanDay, MealPlanMeal };

/** Nested recipe on an unsaved generate draft (confirm creates recipes as needed). */
export type MealPlanRecipeDraft = {
  name: string;
  servings: number;
  ingredients: { name: string; qty: number; unit?: string }[];
  steps: string[];
  tags: string[];
  reuse_recipe_id: string | null;
  dietary?: { safe: boolean; flags?: unknown[] };
};

export type MealPlanDraftMeal = {
  slot: string;
  recipe: MealPlanRecipeDraft;
};

export type MealPlanDraftDay = {
  day: string;
  meals: MealPlanDraftMeal[];
};

/** Unsaved week from generate — confirm before POST /nutrition/meal-plans. */
export interface MealPlanDraft {
  week_of: string;
  days: MealPlanDraftDay[];
  shopping_list: ShoppingListItem[];
  notes: string | null;
  filtered_allergy?: number;
}

export type MealPlanListResult = { status: ApiAvailability; plans: MealPlanRecord[] };
export type MealPlanDetailResult =
  { status: 'ok'; plan: MealPlanRecord } | { status: 'unavailable' | 'error' | 'not_found'; plan: null };

export type GenerateMealPlanResult =
  { status: 'ok'; draft: MealPlanDraft } | { status: 'unavailable' | 'error'; message: string };

export type SaveMealPlanResult =
  { status: 'ok'; plan: MealPlanRecord } | { status: 'unavailable' | 'error'; message: string };

export type PatchMealPlanResult =
  { status: 'ok'; plan: MealPlanRecord } | { status: 'unavailable' | 'error'; message: string };

export type DiscoverRecipesResult =
  | { status: 'ok'; drafts: RecipeDraft[]; notes: string | null; filtered_allergy: number }
  | { status: 'unavailable' | 'error'; message: string };

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object';
}

function parseShoppingItem(raw: unknown): ShoppingListItem | null {
  if (!isRecord(raw) || typeof raw.name !== 'string' || !raw.name.trim()) return null;
  return {
    name: raw.name.trim(),
    qty: typeof raw.qty === 'string' ? raw.qty : raw.qty != null ? String(raw.qty) : '',
    category: typeof raw.category === 'string' ? raw.category : 'other',
    checked: raw.checked === true,
  };
}

function parseShoppingList(raw: unknown): ShoppingListItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ShoppingListItem[] = [];
  for (const row of raw) {
    const item = parseShoppingItem(row);
    if (item) out.push(item);
  }
  return out;
}

/**
 * One thing in a composed meal (frame 10a — "recipes, food, or both"). Mirrors the server's
 * `planItemSchema` (`apps/cadence-api/src/validation/meal-plan.ts`): kind + id + name + qty are
 * required, macros are denormalized and optional.
 */
function parsePlanItem(raw: unknown): MealPlanItem | null {
  if (!isRecord(raw)) return null;
  const kind = raw.kind === 'recipe' || raw.kind === 'food' ? raw.kind : null;
  const id = typeof raw.id === 'string' ? raw.id : '';
  const name = typeof raw.name === 'string' ? raw.name : '';
  const qty = typeof raw.qty === 'number' ? raw.qty : Number(raw.qty);
  if (!kind || !id.trim() || !name.trim() || !Number.isFinite(qty) || qty <= 0) return null;
  const item: MealPlanItem = { kind, id, name: name.trim(), qty };
  if (typeof raw.unit === 'string' && raw.unit.trim()) item.unit = raw.unit.trim();
  if (typeof raw.kcal === 'number') item.kcal = raw.kcal;
  if (typeof raw.protein_g === 'number') item.protein_g = raw.protein_g;
  if (typeof raw.carbs_g === 'number') item.carbs_g = raw.carbs_g;
  if (typeof raw.fat_g === 'number') item.fat_g = raw.fat_g;
  return item;
}

function parsePlanItems(raw: unknown): MealPlanItem[] {
  if (!Array.isArray(raw)) return [];
  const out: MealPlanItem[] = [];
  for (const row of raw) {
    const item = parsePlanItem(row);
    if (item) out.push(item);
  }
  return out;
}

/**
 * MP18 — the server persists a meal as EITHER the legacy single recipe (`recipe_id`) or a composed
 * list (`items`), never neither (see `persistedMealSchema`'s refine, same file). This used to hard
 * -require `recipe_id` and never read `items` or `name` at all, so every composed meal the server
 * saved correctly came back from a GET as if it had never been written. Mirror the server's own
 * either/or check instead of the old both-required one.
 */
function parsePersistedMeal(raw: unknown): MealPlanMeal | null {
  if (!isRecord(raw)) return null;
  const slot = typeof raw.slot === 'string' ? raw.slot : '';
  if (!slot.trim()) return null;
  const recipeId = typeof raw.recipe_id === 'string' ? raw.recipe_id : '';
  const items = parsePlanItems(raw.items);
  if (!recipeId.trim() && !items.length) return null;
  const meal: MealPlanMeal = { slot: slot.trim() };
  if (recipeId.trim()) meal.recipe_id = recipeId;
  if (items.length) meal.items = items;
  if (typeof raw.recipe_name === 'string' && raw.recipe_name.trim()) {
    meal.recipe_name = raw.recipe_name.trim();
  }
  if (typeof raw.name === 'string' && raw.name.trim()) {
    meal.name = raw.name.trim();
  }
  return meal;
}

function parsePersistedDay(raw: unknown): MealPlanDay | null {
  if (!isRecord(raw) || typeof raw.day !== 'string' || !raw.day.trim()) return null;
  const meals: MealPlanMeal[] = [];
  for (const m of Array.isArray(raw.meals) ? raw.meals : []) {
    const meal = parsePersistedMeal(m);
    if (meal) meals.push(meal);
  }
  return { day: raw.day.trim(), meals };
}

function unwrapPlanBody(body: unknown): unknown {
  if (isRecord(body) && 'meal_plan' in body) return body.meal_plan;
  if (isRecord(body) && 'plan' in body) return body.plan;
  if (isRecord(body) && 'draft' in body) return body.draft;
  return body;
}

/** Parse a persisted meal plan from API JSON. */
export function parseMealPlan(raw: unknown): MealPlanRecord | null {
  const body = unwrapPlanBody(raw);
  if (!isRecord(body)) return null;
  const weekOf = typeof body.week_of === 'string' ? body.week_of : '';
  if (!weekOf.trim()) return null;
  const id = typeof body.meal_plan_id === 'string' ? body.meal_plan_id : '';
  const days: MealPlanDay[] = [];
  for (const d of Array.isArray(body.days) ? body.days : []) {
    const day = parsePersistedDay(d);
    if (day) days.push(day);
  }
  const plan: MealPlanRecord = {
    meal_plan_id: id,
    week_of: weekOf.trim(),
    days,
    shopping_list: parseShoppingList(body.shopping_list),
  };
  if (typeof body.notes === 'string' || body.notes === null) plan.notes = body.notes;
  return plan;
}

function parseRecipeDraftNested(raw: unknown): MealPlanRecipeDraft | null {
  if (!isRecord(raw) || typeof raw.name !== 'string' || !raw.name.trim()) return null;
  const servings = typeof raw.servings === 'number' && raw.servings > 0 ? Math.max(1, Math.round(raw.servings)) : 1;
  const ingredients: MealPlanRecipeDraft['ingredients'] = [];
  for (const row of Array.isArray(raw.ingredients) ? raw.ingredients : []) {
    if (!isRecord(row) || typeof row.name !== 'string' || !row.name.trim()) continue;
    const qty = typeof row.qty === 'number' && row.qty > 0 ? row.qty : Number(row.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const ing: MealPlanRecipeDraft['ingredients'][number] = { name: row.name.trim(), qty };
    if (typeof row.unit === 'string' && row.unit.trim()) ing.unit = row.unit.trim();
    ingredients.push(ing);
  }
  if (!ingredients.length) return null;
  const steps = Array.isArray(raw.steps)
    ? raw.steps.filter((s): s is string => typeof s === 'string' && !!s.trim())
    : [];
  const tags = Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string' && !!t.trim()) : [];
  const reuse =
    typeof raw.reuse_recipe_id === 'string' && raw.reuse_recipe_id.trim() ? raw.reuse_recipe_id.trim() : null;
  const draft: MealPlanRecipeDraft = {
    name: raw.name.trim(),
    servings,
    ingredients,
    steps,
    tags,
    reuse_recipe_id: reuse,
  };
  if (isRecord(raw.dietary) && typeof raw.dietary.safe === 'boolean') {
    draft.dietary = {
      safe: raw.dietary.safe,
      ...(Array.isArray(raw.dietary.flags) ? { flags: raw.dietary.flags } : {}),
    };
  }
  return draft;
}

function parseDraftDay(raw: unknown): MealPlanDraftDay | null {
  if (!isRecord(raw) || typeof raw.day !== 'string' || !raw.day.trim()) return null;
  const meals: MealPlanDraftMeal[] = [];
  for (const m of Array.isArray(raw.meals) ? raw.meals : []) {
    if (!isRecord(m) || typeof m.slot !== 'string' || !m.slot.trim()) continue;
    const recipe = parseRecipeDraftNested(m.recipe);
    if (!recipe) continue;
    meals.push({ slot: m.slot.trim(), recipe });
  }
  if (!meals.length) return null;
  return { day: raw.day.trim(), meals };
}

export function parseMealPlanDraft(raw: unknown): MealPlanDraft | null {
  const body = unwrapPlanBody(raw);
  if (!isRecord(body) || typeof body.week_of !== 'string' || !body.week_of.trim()) return null;
  const days: MealPlanDraftDay[] = [];
  for (const d of Array.isArray(body.days) ? body.days : []) {
    const day = parseDraftDay(d);
    if (day) days.push(day);
  }
  return {
    week_of: body.week_of.trim(),
    days,
    shopping_list: parseShoppingList(body.shopping_list),
    notes: typeof body.notes === 'string' ? body.notes : null,
    ...(typeof body.filtered_allergy === 'number' ? { filtered_allergy: body.filtered_allergy } : {}),
  };
}

function parsePlanList(body: unknown): MealPlanRecord[] {
  const list =
    isRecord(body) && Array.isArray(body.meal_plans)
      ? body.meal_plans
      : isRecord(body) && Array.isArray(body.plans)
        ? body.plans
        : Array.isArray(body)
          ? body
          : [];
  const out: MealPlanRecord[] = [];
  for (const row of list) {
    const p = parseMealPlan(row);
    if (p) out.push(p);
  }
  return out;
}

/** Monday (local calendar) for the week containing `d`, as YYYY-MM-DD. */
export function weekOfMonday(d = new Date()): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  const yyyy = x.getFullYear();
  const mm = String(x.getMonth() + 1).padStart(2, '0');
  const dd = String(x.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** GET /nutrition/meal-plans */
export async function listMealPlans(): Promise<MealPlanListResult> {
  try {
    const res = await fetch(`${BASE}/nutrition/meal-plans`, { headers: headers() });
    if (res.status === 404) return { status: 'unavailable', plans: [] };
    if (!res.ok) return { status: 'error', plans: [] };
    return { status: 'ok', plans: parsePlanList(await readJson(res)) };
  } catch {
    return { status: 'error', plans: [] };
  }
}

/** GET /nutrition/meal-plans?week_of= — current week (null body → not_found). */
export async function getCurrentMealPlan(weekOf?: string): Promise<MealPlanDetailResult> {
  const week = (weekOf ?? weekOfMonday()).trim();
  try {
    const res = await fetch(`${BASE}/nutrition/meal-plans?week_of=${encodeURIComponent(week)}`, {
      headers: headers(),
    });
    if (res.status === 404) return { status: 'unavailable', plan: null };
    if (!res.ok) return { status: 'error', plan: null };
    const body = await readJson(res);
    if (isRecord(body) && Array.isArray(body.meal_plans)) {
      const match = parsePlanList(body).find((p) => p.week_of === week) ?? null;
      return match ? { status: 'ok', plan: match } : { status: 'not_found', plan: null };
    }
    if (isRecord(body) && (body.meal_plan === null || body.plan === null)) {
      return { status: 'not_found', plan: null };
    }
    const plan = parseMealPlan(body);
    if (!plan?.meal_plan_id) return { status: 'not_found', plan: null };
    return { status: 'ok', plan };
  } catch {
    return { status: 'error', plan: null };
  }
}

/** GET /nutrition/meal-plans/:id */
export async function getMealPlanById(mealPlanId: string): Promise<MealPlanDetailResult> {
  if (!mealPlanId.trim()) return { status: 'error', plan: null };
  try {
    const res = await fetch(`${BASE}/nutrition/meal-plans/${encodeURIComponent(mealPlanId)}`, {
      headers: headers(),
    });
    if (res.status === 404) {
      const body = await readJson(res);
      if (!body) return { status: 'unavailable', plan: null };
      return { status: 'not_found', plan: null };
    }
    if (!res.ok) return { status: 'error', plan: null };
    const plan = parseMealPlan(await readJson(res));
    if (!plan?.meal_plan_id) return { status: 'error', plan: null };
    return { status: 'ok', plan };
  } catch {
    return { status: 'error', plan: null };
  }
}

/**
 * POST /nutrition/meal-plans/generate — prefs → unsaved week draft + shopping list.
 * Confirm before save (brand: provisional until confirmed).
 */
export async function generateMealPlan(input: {
  week_of: string;
  prefs?: string;
  /** Which meals each day carries — the user's selection; the server defaults to dinners only. */
  slots?: ('breakfast' | 'lunch' | 'dinner')[];
  fridge_ingredients?: { name: string; qty?: number; unit?: string }[];
  recipe_ids?: string[];
}): Promise<GenerateMealPlanResult> {
  const week_of = input.week_of.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week_of)) {
    return { status: 'error', message: 'I need a week start date (Monday) to draft meals.' };
  }
  try {
    const body: Record<string, unknown> = { week_of };
    if (input.prefs?.trim()) body.prefs = input.prefs.trim();
    if (input.slots?.length) body.slots = input.slots;
    if (input.fridge_ingredients?.length) body.fridge_ingredients = input.fridge_ingredients;
    if (input.recipe_ids?.length) body.recipe_ids = input.recipe_ids;
    const res = await fetch(`${BASE}/nutrition/meal-plans/generate`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (res.status === 404) {
      return {
        status: 'unavailable',
        message: "Meal plans aren't reachable just now — try again once this week's planning is live.",
      };
    }
    if (!res.ok) {
      return {
        status: 'error',
        message: "Couldn't draft a week just now — try again in a moment, or tell me preferences in Coach.",
      };
    }
    const draft = parseMealPlanDraft(await readJson(res));
    if (!draft || !draft.days.length) {
      return {
        status: 'error',
        message:
          draft?.notes?.trim() || "I couldn't shape a week from that — add a short preference and I'll try again.",
      };
    }
    return { status: 'ok', draft };
  } catch {
    return { status: 'error', message: "Couldn't reach meal-plan drafting — try again in a moment." };
  }
}

/** POST /nutrition/meal-plans — confirm-path save (creates recipes + upserts week). */
export async function saveMealPlan(draft: MealPlanDraft): Promise<SaveMealPlanResult> {
  try {
    const res = await fetch(`${BASE}/nutrition/meal-plans`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        week_of: draft.week_of,
        days: draft.days.map((d) => ({
          day: d.day,
          meals: d.meals.map((m) => ({
            slot: m.slot,
            recipe: {
              name: m.recipe.name,
              servings: m.recipe.servings,
              ingredients: m.recipe.ingredients,
              steps: m.recipe.steps,
              tags: m.recipe.tags,
              reuse_recipe_id: m.recipe.reuse_recipe_id,
            },
          })),
        })),
        shopping_list: draft.shopping_list,
        notes: draft.notes,
      }),
    });
    if (res.status === 404) {
      return {
        status: 'unavailable',
        message: "Couldn't save that week yet — meal plans aren't live on the server.",
      };
    }
    if (!res.ok) {
      return { status: 'error', message: "Couldn't save that week — try again in a moment." };
    }
    const plan = parseMealPlan(await readJson(res));
    if (!plan?.meal_plan_id) {
      return { status: 'error', message: "Saved response didn't look like a meal plan — try again." };
    }
    return { status: 'ok', plan };
  } catch {
    return { status: 'error', message: "Couldn't reach meal-plan save — try again in a moment." };
  }
}

/** PATCH /nutrition/meal-plans/:id — shopping-list checkmarks / light edits. */
export async function patchMealPlan(
  mealPlanId: string,
  patch: { shopping_list?: ShoppingListItem[]; days?: MealPlanDay[]; notes?: string | null },
): Promise<PatchMealPlanResult> {
  if (!mealPlanId.trim()) return { status: 'error', message: 'Missing meal plan.' };
  try {
    const res = await fetch(`${BASE}/nutrition/meal-plans/${encodeURIComponent(mealPlanId)}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify(patch),
    });
    if (res.status === 404) {
      return {
        status: 'unavailable',
        message: "Couldn't update that list — meal plans aren't reachable just now.",
      };
    }
    if (!res.ok) {
      return { status: 'error', message: "Couldn't update the shopping list — try again in a moment." };
    }
    const plan = parseMealPlan(await readJson(res));
    if (!plan) return { status: 'error', message: "Update didn't return a meal plan — try again." };
    return { status: 'ok', plan };
  } catch {
    return { status: 'error', message: "Couldn't reach meal-plan update — try again in a moment." };
  }
}

/**
 * DELETE /nutrition/meal-plans/:id — how a week is un-planned.
 *
 * The Kitchen needs this because a week cannot be emptied any other way: the API's day schema
 * requires at least one meal per day and at least one day per plan, so taking the LAST meal off a
 * week is a delete, not a patch of an empty list.
 */
export async function deleteMealPlan(
  mealPlanId: string,
): Promise<{ status: 'ok' } | { status: 'unavailable' | 'error'; message: string }> {
  if (!mealPlanId.trim()) return { status: 'error', message: 'Missing meal plan.' };
  try {
    const res = await fetch(`${BASE}/nutrition/meal-plans/${encodeURIComponent(mealPlanId)}`, {
      method: 'DELETE',
      headers: headers(),
    });
    if (res.status === 404) {
      return { status: 'unavailable', message: "Couldn't clear that week — meal plans aren't reachable just now." };
    }
    if (!res.ok) return { status: 'error', message: "Couldn't clear that week — try again in a moment." };
    return { status: 'ok' };
  } catch {
    return { status: 'error', message: "Couldn't reach meal plans — try again in a moment." };
  }
}

/**
 * Probe whether recipe discovery is deployed.
 * POST empty body: 404 → hide UI; 400 → route exists (validation).
 */
export async function probeRecipeDiscovery(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/nutrition/recipes/discover`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({}),
    });
    if (res.status === 404) return false;
    if (res.status >= 500) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * POST /nutrition/recipes/discover — query → unsaved RecipeDraft[] (confirm via saveRecipe).
 */
export async function discoverRecipes(query: string): Promise<DiscoverRecipesResult> {
  const q = query.trim();
  if (!q) {
    return {
      status: 'error',
      message: 'Tell me what kind of recipe you want — cuisine, protein, or a dish name.',
    };
  }
  try {
    const res = await fetch(`${BASE}/nutrition/recipes/discover`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ query: q }),
    });
    if (res.status === 404) {
      return {
        status: 'unavailable',
        message: "Finding recipes isn't live yet — try structuring a dish from your own words.",
      };
    }
    if (!res.ok) {
      return { status: 'error', message: "Couldn't look that up just now — try again in a moment." };
    }
    const body = await readJson(res);
    const list =
      isRecord(body) && Array.isArray(body.drafts)
        ? body.drafts
        : isRecord(body) && Array.isArray(body.recipes)
          ? body.recipes
          : [];
    const drafts: RecipeDraft[] = [];
    for (const row of list) {
      const d = parseRecipeDraft(row);
      if (d) drafts.push(d);
    }
    const notes = isRecord(body) && typeof body.notes === 'string' ? body.notes : null;
    const filtered = isRecord(body) && typeof body.filtered_allergy === 'number' ? body.filtered_allergy : 0;
    return { status: 'ok', drafts, notes, filtered_allergy: filtered };
  } catch {
    return { status: 'error', message: "Couldn't reach recipe discovery — try again in a moment." };
  }
}

export function mealPlanDayLabel(day: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    try {
      const d = new Date(`${day}T12:00:00`);
      return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    } catch {
      return day;
    }
  }
  return day;
}

export function shoppingListSummary(list: ShoppingListItem[]): string {
  if (!list.length) return 'No shopping list yet';
  const left = list.filter((i) => !i.checked).length;
  if (left === 0) return `All ${list.length} items checked off`;
  return `${left} to get · ${list.length} total`;
}
