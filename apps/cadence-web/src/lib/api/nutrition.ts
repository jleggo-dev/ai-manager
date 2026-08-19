import { BASE, headers } from './http.ts';

/* ── Nutrition (Observe phase) ─────────────────────────────────── */
export type MealKind = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'drink' | 'other';
/** Mirrors `Macros` in @cadence/shared — macros plus the micronutrients a day can now total. */
export interface MealMacros {
  kcal?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  fiber_g?: number;
  sodium_mg?: number;
  iron_mg?: number;
  zinc_mg?: number;
  vitamin_c_mg?: number;
  calcium_mg?: number;
  potassium_mg?: number;
  vitamin_b12_ug?: number;
  source?: 'ai' | 'user';
}
export interface Meal {
  log_id: string;
  date: string;
  meal: MealKind;
  items: { name: string; qty?: number; unit?: string; est?: MealMacros }[];
  raw_text?: string | null;
  flags?: { alcohol?: boolean; caffeine?: boolean };
  photo_url?: string | null; // short-lived signed URL when the meal was snapped
  macros?: MealMacros; // AI-documented estimates (or the user's correction)
  ai_confidence?: number | null;
  provisional?: boolean; // low-confidence estimate — listed, but outside totals until confirmed
}

export interface NutritionDayData {
  date: string;
  meals: Meal[];
  totals: MealMacros; // confirmed only
  provisional_totals: MealMacros;
  confirmed_count: number;
  provisional_count: number;
  targets: MealMacros | null;
  left: MealMacros | null; // per targets incl. eat-back
  burn_kcal: number; // estimated exercise burn from today's done workouts
  eatback_kcal: number; // the eaten-back share added to the kcal allowance
  eatback_pct: number; // 0–100 setting
  /** Set while a goal WANTS a calorie target and none exists yet: the 7-day countdown. */
  targets_wait?: { days_logged: number; days_needed: number } | null;
  /** Any food signal in the trailing 14 days (or targets set) — the trail strip's door gate. */
  has_recent_food?: boolean;
  /** The day's water in ml (0037). Zero is an honest number — water has no provisional state. */
  water_ml?: number;
}

/** One day's meals + deterministic totals (confirmed vs provisional) + targets/left when set. */
export async function getNutritionDay(date?: string): Promise<NutritionDayData | null> {
  const res = await fetch(`${BASE}/nutrition/day${date ? `?date=${date}` : ''}`, { headers: headers() });
  if (!res.ok) return null;
  return res.json();
}

/**
 * One pour of water, ml. No confirm step and no estimate: the amount the user tapped IS the data,
 * so the day's new total comes straight back. Returns null if it could not be written.
 */
export async function logWater(ml: number, date?: string): Promise<number | null> {
  const res = await fetch(`${BASE}/nutrition/water`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ ml, ...(date ? { date } : {}) }),
  });
  if (!res.ok) return null;
  const out = (await res.json()) as { water_ml?: number };
  return typeof out.water_ml === 'number' ? out.water_ml : null;
}

/** Tap-to-confirm/correct a meal — a bare confirm graduates the AI's numbers into the totals. */
export async function patchMeal(
  logId: string,
  patch: { confirm?: boolean; meal?: MealKind; macros?: MealMacros },
): Promise<Meal | null> {
  const res = await fetch(`${BASE}/nutrition/meals/${logId}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) return null;
  return res.json();
}

/** Confirm/edit daily macro targets (the user's tap; unlocks "left" + rings). */
export async function setMacroTargets(targets: MealMacros): Promise<MealMacros | null> {
  const res = await fetch(`${BASE}/nutrition/targets`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(targets),
  });
  if (!res.ok) return null;
  return (await res.json()).targets;
}

/** Set the net-calorie eat-back % (0–100) — how much of exercise burn to add to the day's allowance. */
export async function setEatbackPct(pct: number): Promise<number | null> {
  const res = await fetch(`${BASE}/nutrition/eatback`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ pct }),
  });
  if (!res.ok) return null;
  return (await res.json()).eatback_pct;
}

export interface PlateAdvice {
  estimate_kcal: number | null;
  advice: string;
  verdict: 'go' | 'tweak' | 'heavy';
}

/** Pre-eat advice on a plate photo (data URL) — one kind, actionable read; creates no meal log. */
/** A read before you eat — from a photo of the plate, or from the meal in their own words. */
export async function getPlateAdvice(input: { photo?: string; meal?: string }): Promise<PlateAdvice | null> {
  const res = await fetch(`${BASE}/nutrition/plate-advice`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(input),
  });
  if (!res.ok) return null;
  return res.json();
}

/** Remove daily targets — back to observe-style (no "left"). */
export async function clearMacroTargets(): Promise<boolean> {
  const res = await fetch(`${BASE}/nutrition/targets`, { method: 'DELETE', headers: headers() });
  return res.ok;
}

/** An itemized read of a described meal — previewed, not logged. Confirm posts it verbatim. */
export interface MealPreview {
  meal: MealKind;
  items: { name: string; qty?: number; unit?: string; est?: MealMacros }[];
  macros: MealMacros | null;
  confidence: number | null;
  flags: { alcohol?: boolean; caffeine?: boolean };
  raw_text: string;
}

/**
 * Parse the words into an itemized meal WITHOUT logging it — the confirm-first read for a
 * multi-ingredient description, where the quantities in the text ARE the serving sizes.
 */
export async function previewMeal(text: string, meal?: MealKind): Promise<MealPreview> {
  const res = await fetch(`${BASE}/nutrition/meals/preview`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ text, ...(meal ? { meal } : {}) }),
  });
  if (!res.ok) throw Object.assign(new Error(`meal preview failed: ${res.status}`), { status: res.status });
  return res.json();
}

/** Log a previewed meal exactly as shown — no second AI pass; the card is what lands. */
export async function logPreviewedMeal(parsed: MealPreview, meal?: MealKind): Promise<Meal> {
  const res = await fetch(`${BASE}/nutrition/meals`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ parsed: { ...parsed, ...(meal ? { meal } : {}) } }),
  });
  if (!res.ok) throw Object.assign(new Error(`meal log failed: ${res.status}`), { status: res.status });
  return res.json();
}

/** Record one meal — their words, a photo, or both. Nothing is ever judged. */
export async function logMeal(text: string, meal?: MealKind, photo?: string): Promise<Meal> {
  const res = await fetch(`${BASE}/nutrition/meals`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ ...(text ? { text } : {}), ...(meal ? { meal } : {}), ...(photo ? { photo } : {}) }),
  });
  if (!res.ok) throw Object.assign(new Error(`meal log failed: ${res.status}`), { status: res.status });
  return res.json();
}

/**
 * Deterministic log of a saved food (Req 5) — serving math on the server, no AI.
 * Soft-fails to null on 404/network so the Food tab can warm-message without throwing.
 */
export async function logMealFromFood(input: {
  food_id: string;
  meal?: MealKind;
  serving_index?: number;
  quantity?: number;
}): Promise<Meal | null> {
  try {
    const res = await fetch(`${BASE}/nutrition/meals`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        food_id: input.food_id,
        ...(input.meal ? { meal: input.meal } : {}),
        ...(typeof input.serving_index === 'number' ? { serving_index: input.serving_index } : {}),
        ...(typeof input.quantity === 'number' ? { quantity: input.quantity } : {}),
      }),
    });
    if (res.status === 404 || !res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/**
 * Deterministic log of a saved recipe (Req 5 Phase 2 / WS3) — N servings, no AI.
 * POST /nutrition/meals accepts recipe_id + servings (alias for quantity).
 */
export async function logMealFromRecipe(input: {
  recipe_id: string;
  servings?: number;
  meal?: MealKind;
}): Promise<Meal | null> {
  try {
    const servings =
      typeof input.servings === 'number' && Number.isFinite(input.servings) && input.servings > 0 ? input.servings : 1;
    const res = await fetch(`${BASE}/nutrition/meals`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        recipe_id: input.recipe_id,
        servings,
        quantity: servings,
        ...(input.meal ? { meal: input.meal } : {}),
      }),
    });
    if (res.status === 404 || !res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export interface PlateItem {
  food_id: string;
  serving_index?: number;
  quantity?: number;
}

/**
 * Deterministic log of a plate (design 2D) — N saved-food items composed into ONE meal, macros summed
 * server-side. `nutrition_logs.items[]` is exactly this shape, so it's one write, one meal, N items.
 */
export async function logMealFromItems(input: { items: PlateItem[]; meal?: MealKind }): Promise<Meal | null> {
  try {
    const res = await fetch(`${BASE}/nutrition/meals`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ items: input.items, ...(input.meal ? { meal: input.meal } : {}) }),
    });
    if (res.status === 404 || !res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/** Recent meals, newest first (the food-log sheet's list). */
export async function getRecentMeals(days = 7): Promise<Meal[]> {
  const res = await fetch(`${BASE}/nutrition/recent?days=${days}`, { headers: headers() });
  if (!res.ok) return [];
  const body = (await res.json()) as { meals?: Meal[] };
  return body.meals ?? [];
}

export type BaselineRead =
  | { ready: false; days_logged: number; days_needed: number }
  | {
      ready: true;
      read: string;
      suggestion: string;
      rationale: string;
      proposed_targets?: MealMacros | null;
      targets_rationale?: string | null;
    };

/** The Baseline moment — the coach's pattern read + ONE gradual change (7+ observed days). */
export async function getBaselineRead(): Promise<BaselineRead> {
  const res = await fetch(`${BASE}/nutrition/baseline`, { method: 'POST', headers: headers() });
  if (!res.ok) throw Object.assign(new Error(`baseline failed: ${res.status}`), { status: res.status });
  return res.json();
}

/* ── Req 5 WS-I insight card ─────────────────────────────────── */
export type NutritionInsightKind = 'macro' | 'pattern' | 'variety' | 'micro';
export type NutritionInsightStatus = 'quiet' | 'observing' | 'on_track' | 'room_left' | 'a_little_over';

export interface NutritionInsightItem {
  kind: NutritionInsightKind;
  body: string;
}

export interface NutritionInsightPack {
  status: NutritionInsightStatus;
  status_line: string;
  primary: NutritionInsightItem | null;
  more: NutritionInsightItem[];
  drill: {
    date: string;
    macros: Array<{
      key: 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g';
      label: string;
      eaten: number;
      target: number | null;
      left: number | null;
    }>;
    meals: Array<{
      meal: MealKind;
      summary: string;
      kcal: number | null;
      provisional?: boolean;
    }>;
    window: {
      days_logged: number;
      window_days: number;
      top_items: { name: string; count: number }[];
    };
  };
}

/** Coach-voiced nutrition insight for Today / Food (deterministic; soft-fails to null). */
export async function getNutritionInsight(date?: string): Promise<NutritionInsightPack | null> {
  try {
    const res = await fetch(`${BASE}/nutrition/insight${date ? `?date=${date}` : ''}`, { headers: headers() });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}
