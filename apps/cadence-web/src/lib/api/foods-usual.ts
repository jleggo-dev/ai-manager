/**
 * "You usually have at breakfast" — the quick-add sheet's slot-aware list (design 05a).
 * Day-wide recents live in `foods.ts`; this one is counted and scoped to one meal.
 */
import { BASE, headers } from './http.ts';
import type { MealKind } from './nutrition.ts';

export interface UsualAtSlot {
  kind: 'food' | 'recipe';
  id: string;
  name: string;
  serving_label: string | null;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  count: number;
}

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

function parseUsual(body: unknown): UsualAtSlot[] {
  const raw = body && typeof body === 'object' ? (body as { items?: unknown }).items : null;
  if (!Array.isArray(raw)) return [];
  const out: UsualAtSlot[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.name !== 'string') continue;
    out.push({
      kind: o.kind === 'recipe' ? 'recipe' : 'food',
      id: o.id,
      name: o.name,
      serving_label: typeof o.serving_label === 'string' ? o.serving_label : null,
      kcal: num(o.kcal),
      protein_g: num(o.protein_g),
      carbs_g: num(o.carbs_g),
      fat_g: num(o.fat_g),
      count: typeof o.count === 'number' ? o.count : 0,
    });
  }
  return out;
}

/** GET /nutrition/foods/usual?meal= — never throws; an empty list just means no habit yet. */
export async function getUsualAtSlot(meal: MealKind, limit = 6): Promise<UsualAtSlot[]> {
  try {
    const res = await fetch(`${BASE}/nutrition/foods/usual?meal=${encodeURIComponent(meal)}&limit=${limit}`, {
      headers: headers(),
    });
    if (!res.ok) return [];
    return parseUsual(await res.json().catch(() => null));
  } catch {
    return [];
  }
}
