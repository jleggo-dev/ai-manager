import { BASE, headers } from './http.ts';

/* ── Nutrition (Observe phase) ─────────────────────────────────── */
export type MealKind = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'drink' | 'other';
export interface MealMacros {
  kcal?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
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
}

/** One day's meals + deterministic totals (confirmed vs provisional) + targets/left when set. */
export async function getNutritionDay(date?: string): Promise<NutritionDayData | null> {
  const res = await fetch(`${BASE}/nutrition/day${date ? `?date=${date}` : ''}`, { headers: headers() });
  if (!res.ok) return null;
  return res.json();
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
export async function getPlateAdvice(photo: string): Promise<PlateAdvice | null> {
  const res = await fetch(`${BASE}/nutrition/plate-advice`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ photo }),
  });
  if (!res.ok) return null;
  return res.json();
}

/** Remove daily targets — back to observe-style (no "left"). */
export async function clearMacroTargets(): Promise<boolean> {
  const res = await fetch(`${BASE}/nutrition/targets`, { method: 'DELETE', headers: headers() });
  return res.ok;
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
