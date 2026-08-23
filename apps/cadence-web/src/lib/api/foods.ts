/**
 * Req 5 food / dietary API client (WS4 + WS5).
 *
 * Wired to WS1 + WS2 routes:
 *   GET/POST /nutrition/dietary-profile
 *   GET /nutrition/foods/search?q=
 *   GET /nutrition/foods/recents
 *   GET /nutrition/foods/:id
 *   POST /nutrition/foods
 *   POST /nutrition/foods/{estimate,parse-label,identify}
 *
 * Soft-handles 404/network so Settings + Food tab stay usable if a deploy lags.
 *
 * Resolve (WS-R): see `./foods-resolve.ts` — Food tab Say/Search prefer it over
 * ad-hoc search+estimate for ranked candidates + preselected serving/qty.
 */

import {
  EMPTY_DIETARY_PROFILE,
  sanitizeDietaryProfile,
  type DietaryProfile,
  type Food,
  type FoodBaseUnit,
  type FoodNutrients,
  type FoodServing,
  type FoodSource,
  type FoodVisibility,
} from '@cadence/shared';
import { BASE, headers } from './http.ts';

export type ApiAvailability = 'ok' | 'unavailable' | 'error';

export interface DietaryProfileResult {
  status: ApiAvailability;
  profile: DietaryProfile;
}

export interface FoodSummary {
  food_id: string;
  name: string;
  brand?: string | null;
  /** Optional one-line serving hint for the recents list. */
  serving_label?: string | null;
}

export interface FoodListResult {
  status: ApiAvailability;
  foods: FoodSummary[];
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function unavailableDietary(): DietaryProfileResult {
  return { status: 'unavailable', profile: { ...EMPTY_DIETARY_PROFILE, allergies: [], dislikes: [] } };
}

function dietaryFromBody(body: unknown): DietaryProfile {
  const raw =
    body && typeof body === 'object' && 'dietary_profile' in (body as object)
      ? (body as { dietary_profile: unknown }).dietary_profile
      : body && typeof body === 'object' && 'profile' in (body as object)
        ? (body as { profile: unknown }).profile
        : body;
  return sanitizeDietaryProfile(raw) ?? { ...EMPTY_DIETARY_PROFILE };
}

/** GET /nutrition/dietary-profile */
export async function getDietaryProfile(): Promise<DietaryProfileResult> {
  try {
    const res = await fetch(`${BASE}/nutrition/dietary-profile`, { headers: headers() });
    if (res.status === 404) return unavailableDietary();
    if (!res.ok) return { status: 'error', profile: { ...EMPTY_DIETARY_PROFILE } };
    return { status: 'ok', profile: dietaryFromBody(await readJson(res)) };
  } catch {
    return { status: 'error', profile: { ...EMPTY_DIETARY_PROFILE } };
  }
}

/**
 * POST /nutrition/dietary-profile — confirm-first save from Settings.
 * Returns null when the route is missing (404) or the body was rejected.
 */
export async function saveDietaryProfile(profile: DietaryProfile): Promise<DietaryProfile | null> {
  try {
    const res = await fetch(`${BASE}/nutrition/dietary-profile`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        allergies: profile.allergies,
        diet: profile.diet,
        dislikes: profile.dislikes,
        notes: profile.notes,
      }),
    });
    if (res.status === 404 || !res.ok) return null;
    return dietaryFromBody(await readJson(res));
  } catch {
    return null;
  }
}

function servingLabelFromFood(r: Record<string, unknown>): string | null {
  if (typeof r.serving_label === 'string' && r.serving_label.trim()) return r.serving_label;
  if (!Array.isArray(r.servings) || r.servings.length === 0) return null;
  const idx =
    typeof r.default_serving === 'number' && Number.isFinite(r.default_serving)
      ? Math.max(0, Math.trunc(r.default_serving))
      : 0;
  const serving = r.servings[Math.min(idx, r.servings.length - 1)];
  if (!serving || typeof serving !== 'object') return null;
  const label = (serving as { label?: unknown }).label;
  return typeof label === 'string' && label.trim() ? label : null;
}

function parseFoodList(body: unknown): FoodSummary[] {
  const list =
    body && typeof body === 'object' && Array.isArray((body as { foods?: unknown }).foods)
      ? (body as { foods: unknown[] }).foods
      : Array.isArray(body)
        ? body
        : [];
  const out: FoodSummary[] = [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const food_id = typeof r.food_id === 'string' ? r.food_id : typeof r.id === 'string' ? r.id : '';
    const name = typeof r.name === 'string' ? r.name : '';
    if (!food_id || !name) continue;
    out.push({
      food_id,
      name,
      brand: typeof r.brand === 'string' ? r.brand : null,
      serving_label: servingLabelFromFood(r),
    });
  }
  return out;
}

/** GET /nutrition/foods/recents */
export async function getFoodRecents(): Promise<FoodListResult> {
  try {
    const res = await fetch(`${BASE}/nutrition/foods/recents`, { headers: headers() });
    if (res.status === 404) return { status: 'unavailable', foods: [] };
    if (!res.ok) return { status: 'error', foods: [] };
    return { status: 'ok', foods: parseFoodList(await readJson(res)) };
  } catch {
    return { status: 'error', foods: [] };
  }
}

/** GET /nutrition/foods/search?q= */
export async function searchFoods(q: string): Promise<FoodListResult> {
  const query = q.trim();
  if (!query) return { status: 'ok', foods: [] };
  try {
    const res = await fetch(`${BASE}/nutrition/foods/search?q=${encodeURIComponent(query)}`, {
      headers: headers(),
    });
    if (res.status === 404) return { status: 'unavailable', foods: [] };
    if (!res.ok) return { status: 'error', foods: [] };
    return { status: 'ok', foods: parseFoodList(await readJson(res)) };
  } catch {
    return { status: 'error', foods: [] };
  }
}

/** Unsaved food shape from estimate / parse-label — ready for POST /nutrition/foods. */
export interface FoodCandidate {
  name: string;
  brand: string | null;
  source: FoodSource;
  base_unit: FoodBaseUnit;
  macros_per_base: FoodNutrients;
  servings: FoodServing[];
  default_serving: number;
  confidence: number | null;
  photo_ref: string | null;
}

export type FoodCaptureResult =
  { status: 'ok'; candidate: FoodCandidate } | { status: 'unavailable' | 'error'; message: string };

export type FoodDetailResult =
  { status: 'ok'; food: Food } | { status: 'unavailable' | 'error' | 'not_found'; food: null };

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object';
}

function parseCandidate(raw: unknown): FoodCandidate | null {
  if (!isRecord(raw)) return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return null;
  const base_unit = raw.base_unit;
  if (base_unit !== 'g' && base_unit !== 'ml' && base_unit !== 'item') return null;
  const source = raw.source;
  if (
    source !== 'llm' &&
    source !== 'label_photo' &&
    source !== 'manual' &&
    source !== 'chat' &&
    source !== 'usda' &&
    source !== 'off'
  )
    return null;
  if (!isRecord(raw.macros_per_base) || !Array.isArray(raw.servings) || raw.servings.length === 0) return null;
  const servings: FoodServing[] = [];
  for (const s of raw.servings) {
    if (!isRecord(s)) continue;
    if (typeof s.label !== 'string' || typeof s.unit !== 'string' || typeof s.amount_g !== 'number') continue;
    servings.push({ label: s.label, unit: s.unit, amount_g: s.amount_g });
  }
  if (!servings.length) return null;
  const default_serving =
    typeof raw.default_serving === 'number' && Number.isInteger(raw.default_serving) ? raw.default_serving : 0;
  return {
    name,
    brand: typeof raw.brand === 'string' ? raw.brand : null,
    source,
    base_unit,
    macros_per_base: raw.macros_per_base as FoodNutrients,
    servings,
    default_serving: Math.max(0, Math.min(default_serving, servings.length - 1)),
    confidence: typeof raw.confidence === 'number' ? raw.confidence : null,
    photo_ref: typeof raw.photo_ref === 'string' ? raw.photo_ref : null,
  };
}

function parseFoodDetail(raw: unknown): Food | null {
  const c = parseCandidate(raw);
  if (!c || !isRecord(raw)) return null;
  const food_id = typeof raw.food_id === 'string' ? raw.food_id : '';
  if (!food_id) return null;
  return {
    food_id,
    owner_user_id: typeof raw.owner_user_id === 'string' ? raw.owner_user_id : null,
    visibility: raw.visibility === 'shared' ? 'shared' : 'private',
    name: c.name,
    brand: c.brand,
    source: c.source,
    off_id: typeof raw.off_id === 'string' ? raw.off_id : null,
    fdc_id: typeof raw.fdc_id === 'number' && Number.isInteger(raw.fdc_id) ? raw.fdc_id : null,
    base_unit: c.base_unit,
    macros_per_base: c.macros_per_base,
    servings: c.servings,
    default_serving: c.default_serving,
    confidence: c.confidence,
    photo_ref: c.photo_ref,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : undefined,
  };
}

/** GET /nutrition/foods/:id */
export async function getFoodById(foodId: string): Promise<FoodDetailResult> {
  if (!foodId.trim()) return { status: 'error', food: null };
  try {
    const res = await fetch(`${BASE}/nutrition/foods/${encodeURIComponent(foodId)}`, { headers: headers() });
    if (res.status === 404) {
      const body = await readJson(res);
      // Missing route vs missing row — both 404; treat empty body as unavailable route.
      if (!body) return { status: 'unavailable', food: null };
      return { status: 'not_found', food: null };
    }
    if (!res.ok) return { status: 'error', food: null };
    const food = parseFoodDetail(await readJson(res));
    if (!food) return { status: 'error', food: null };
    return { status: 'ok', food };
  } catch {
    return { status: 'error', food: null };
  }
}

/** POST /nutrition/foods/estimate — describe text → unsaved candidate. */
export async function estimateFood(text: string): Promise<FoodCaptureResult> {
  const trimmed = text.trim();
  if (!trimmed) return { status: 'error', message: 'Tell me a little about what you ate first.' };
  try {
    const res = await fetch(`${BASE}/nutrition/foods/estimate`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ text: trimmed }),
    });
    if (res.status === 404) {
      return {
        status: 'unavailable',
        message: "Food capture isn't reachable just now — try saying it in Coach, or try again in a moment.",
      };
    }
    if (!res.ok) {
      return { status: 'error', message: "Couldn't draft that food just now — try again in a moment." };
    }
    const body = await readJson(res);
    const raw = isRecord(body) && 'candidate' in body ? (body as { candidate: unknown }).candidate : body;
    const candidate = parseCandidate(raw);
    if (!candidate) return { status: 'error', message: "I couldn't shape that into a food — try a bit more detail." };
    return { status: 'ok', candidate };
  } catch {
    return { status: 'error', message: "Couldn't reach food capture — try again in a moment." };
  }
}

export interface CreateFoodInput {
  name: string;
  brand?: string | null;
  source: FoodSource;
  base_unit: FoodBaseUnit;
  macros_per_base: FoodNutrients;
  servings: FoodServing[];
  default_serving?: number;
  confidence?: number | null;
  photo_ref?: string | null;
  visibility?: FoodVisibility;
}

/** POST /nutrition/foods — confirm-path save (private by default). */
export async function createFood(input: CreateFoodInput): Promise<Food | null> {
  try {
    const res = await fetch(`${BASE}/nutrition/foods`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        name: input.name,
        brand: input.brand ?? null,
        source: input.source,
        base_unit: input.base_unit,
        macros_per_base: input.macros_per_base,
        servings: input.servings,
        default_serving: input.default_serving ?? 0,
        confidence: input.confidence ?? null,
        photo_ref: input.photo_ref ?? null,
        visibility: input.visibility ?? 'private',
      }),
    });
    if (res.status === 404 || !res.ok) return null;
    return parseFoodDetail(await readJson(res));
  } catch {
    return null;
  }
}

/**
 * Forget a food you saved. Since A23 an unmatched food is PINNED automatically, so a mis-parsed
 * one ("dill pickles", from a caption about dill-pickle-seasoned peanuts) would otherwise keep
 * resolving forever. The API has always allowed this; nothing in the app could reach it.
 */
export async function deleteFood(foodId: string): Promise<boolean> {
  const res = await fetch(`${BASE}/nutrition/foods/${foodId}`, { method: 'DELETE', headers: headers() });
  return res.ok;
}

/** Rename a saved food, or fix its brand — the numbers can be right while the label is wrong. */
export async function updateFood(foodId: string, patch: { name?: string; brand?: string | null }): Promise<boolean> {
  const res = await fetch(`${BASE}/nutrition/foods/${foodId}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify(patch),
  });
  return res.ok;
}
