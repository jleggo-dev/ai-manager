/**
 * Req 5 food / dietary API client (WS4 + WS5).
 *
 * Wired to WS1 routes:
 *   GET/POST /nutrition/dietary-profile
 *   GET /nutrition/foods/search?q=
 *   GET /nutrition/foods/recents
 *
 * Soft-handles 404/network so Settings + Food tab stay usable if a deploy lags.
 */

import { EMPTY_DIETARY_PROFILE, sanitizeDietaryProfile, type DietaryProfile } from '@cadence/shared';
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
