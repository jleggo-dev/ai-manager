/**
 * What you have at breakfast — the meal screen's Usual shelf: everything ever logged at one slot,
 * most recently logged first, one page at a time. Day-wide recents live in `foods.ts`.
 */
import { BASE, headers } from './http.ts';
import type { MealKind } from './nutrition.ts';

export interface UsualAtSlot {
  kind: 'food' | 'recipe';
  id: string;
  name: string;
  brand: string | null;
  serving_label: string | null;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  count: number;
  /** When it was last logged at this slot (YYYY-MM-DD) — what the list is ordered by. */
  last_date: string | null;
}

export interface UsualPage {
  items: UsualAtSlot[];
  /** Hand back as `cursor` for the next page; null when the list is done. */
  nextCursor: string | null;
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
      brand: typeof o.brand === 'string' && o.brand.trim() ? o.brand : null,
      serving_label: typeof o.serving_label === 'string' ? o.serving_label : null,
      kcal: num(o.kcal),
      protein_g: num(o.protein_g),
      carbs_g: num(o.carbs_g),
      fat_g: num(o.fat_g),
      count: typeof o.count === 'number' ? o.count : 0,
      last_date: typeof o.last_date === 'string' ? o.last_date : null,
    });
  }
  return out;
}

/**
 * GET /nutrition/foods/usual?meal=&limit=&cursor= — one page. THROWS on failure: it backs a
 * persisted query, and a soft-failed empty page would be cached as "nothing logged here" and
 * painted again on the next launch (the soft-fail-is-not-an-answer rule).
 */
export async function getUsualAtSlot(meal: MealKind, limit = 30, cursor: string | null = null): Promise<UsualPage> {
  const q = new URLSearchParams({ meal, limit: String(limit) });
  if (cursor) q.set('cursor', cursor);
  const res = await fetch(`${BASE}/nutrition/foods/usual?${q}`, { headers: headers() });
  if (!res.ok) throw new Error(`usual foods: ${res.status}`);
  const body: unknown = await res.json();
  const next = body && typeof body === 'object' ? (body as { next_cursor?: unknown }).next_cursor : null;
  return { items: parseUsual(body), nextCursor: typeof next === 'string' ? next : null };
}
