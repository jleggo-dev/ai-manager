/**
 * Cadence API client for Open Food Facts cache (import / by-off lookup).
 * Browser still calls OFF itself; these routes only upsert/read shared foods.
 */
import type { Food } from '@cadence/shared';
import { BASE, headers } from './http.ts';
import type { OffMappedFood } from '../off/map-product.ts';

export type OffFoodCacheResult =
  | { status: 'ok'; food: Food; cached: boolean }
  | { status: 'not_found' }
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

function parseFood(raw: unknown): Food | null {
  if (!isRecord(raw)) return null;
  const food_id = typeof raw.food_id === 'string' ? raw.food_id : '';
  const name = typeof raw.name === 'string' ? raw.name : '';
  if (!food_id || !name) return null;
  const base_unit = raw.base_unit;
  if (base_unit !== 'g' && base_unit !== 'ml' && base_unit !== 'item') return null;
  if (!isRecord(raw.macros_per_base) || !Array.isArray(raw.servings)) return null;
  const servings = [];
  for (const s of raw.servings) {
    if (!isRecord(s)) continue;
    if (typeof s.label !== 'string' || typeof s.unit !== 'string' || typeof s.amount_g !== 'number') continue;
    servings.push({ label: s.label, unit: s.unit, amount_g: s.amount_g });
  }
  if (!servings.length) return null;
  return {
    food_id,
    owner_user_id: typeof raw.owner_user_id === 'string' ? raw.owner_user_id : null,
    visibility: raw.visibility === 'shared' ? 'shared' : 'private',
    name,
    brand: typeof raw.brand === 'string' ? raw.brand : null,
    source: 'off',
    off_id: typeof raw.off_id === 'string' ? raw.off_id : null,
    fdc_id: typeof raw.fdc_id === 'number' && Number.isInteger(raw.fdc_id) ? raw.fdc_id : null,
    base_unit,
    macros_per_base: raw.macros_per_base as Food['macros_per_base'],
    servings,
    default_serving:
      typeof raw.default_serving === 'number' && Number.isInteger(raw.default_serving) ? raw.default_serving : 0,
    confidence: typeof raw.confidence === 'number' ? raw.confidence : null,
    photo_ref: typeof raw.photo_ref === 'string' ? raw.photo_ref : null,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : undefined,
  };
}

/** GET /nutrition/foods/by-off/:offId — prefer DB cache before hitting OFF. */
export async function getFoodByOffId(offId: string): Promise<OffFoodCacheResult> {
  const id = offId.replace(/\D/g, '');
  if (!id) return { status: 'error', message: 'Enter a barcode with 8–14 digits.' };
  try {
    const res = await fetch(`${BASE}/nutrition/foods/by-off/${encodeURIComponent(id)}`, {
      headers: headers(),
    });
    if (res.status === 404) {
      const body = await readJson(res);
      if (!body) return { status: 'unavailable', message: "Food cache isn't reachable just now." };
      return { status: 'not_found' };
    }
    if (!res.ok) return { status: 'error', message: "Couldn't check saved foods just now." };
    const food = parseFood(await readJson(res));
    if (!food) return { status: 'error', message: "Couldn't read that saved food." };
    return { status: 'ok', food, cached: true };
  } catch {
    return { status: 'unavailable', message: "Couldn't reach the food cache — try again in a moment." };
  }
}

/**
 * POST /nutrition/foods/import-off — upsert shared Food (source='off').
 * Call after a successful browser → OFF product lookup (or when refreshing cache).
 */
export async function importOffFood(mapped: OffMappedFood): Promise<OffFoodCacheResult> {
  try {
    const res = await fetch(`${BASE}/nutrition/foods/import-off`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        name: mapped.name,
        brand: mapped.brand,
        off_id: mapped.off_id,
        base_unit: mapped.base_unit,
        macros_per_base: mapped.macros_per_base,
        servings: mapped.servings,
        default_serving: mapped.default_serving,
        confidence: mapped.confidence,
      }),
    });
    if (res.status === 404) {
      return {
        status: 'unavailable',
        message: "Saving Open Food Facts foods isn't reachable just now — try again after deploy.",
      };
    }
    if (res.status === 400) {
      return { status: 'error', message: "That product couldn't be saved — try snapping the label instead." };
    }
    if (!res.ok) return { status: 'error', message: "Couldn't save that food just now — try again." };
    const body = await readJson(res);
    const raw = isRecord(body) && 'food' in body ? (body as { food: unknown }).food : body;
    const food = parseFood(raw);
    if (!food) return { status: 'error', message: "Saved, but couldn't read the food back." };
    return { status: 'ok', food, cached: isRecord(body) ? body.cached === true : false };
  } catch {
    return { status: 'unavailable', message: "Couldn't reach Cadence to save that food — try again." };
  }
}
