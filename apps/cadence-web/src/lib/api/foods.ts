/**
 * Req 5 food / dietary API client (WS4 + WS5).
 *
 * Endpoints land with WS1 — until then every call treats 404 as "not ready yet"
 * and returns a graceful empty / unavailable result (never throws for missing routes).
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

/** GET /nutrition/dietary-profile — empty profile + unavailable when the route is not on main yet. */
export async function getDietaryProfile(): Promise<DietaryProfileResult> {
  try {
    const res = await fetch(`${BASE}/nutrition/dietary-profile`, { headers: headers() });
    if (res.status === 404) return unavailableDietary();
    if (!res.ok) return { status: 'error', profile: { ...EMPTY_DIETARY_PROFILE } };
    const body = await readJson(res);
    const raw =
      body && typeof body === 'object' && 'dietary_profile' in (body as object)
        ? (body as { dietary_profile: unknown }).dietary_profile
        : body && typeof body === 'object' && 'profile' in (body as object)
          ? (body as { profile: unknown }).profile
          : body;
    const profile = sanitizeDietaryProfile(raw) ?? { ...EMPTY_DIETARY_PROFILE };
    return { status: 'ok', profile };
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
      body: JSON.stringify(profile),
    });
    if (res.status === 404 || !res.ok) return null;
    const body = await readJson(res);
    const raw =
      body && typeof body === 'object' && 'dietary_profile' in (body as object)
        ? (body as { dietary_profile: unknown }).dietary_profile
        : body && typeof body === 'object' && 'profile' in (body as object)
          ? (body as { profile: unknown }).profile
          : body;
    return sanitizeDietaryProfile(raw) ?? profile;
  } catch {
    return null;
  }
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
      serving_label: typeof r.serving_label === 'string' ? r.serving_label : null,
    });
  }
  return out;
}

/** GET /nutrition/foods/recents — empty list when the route is not ready. */
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

/** GET /nutrition/foods/search?q= — empty list when the route is not ready. */
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
