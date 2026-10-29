/**
 * The meal screen's Usual shelf, as a pure walk over nutrition_logs (no DB): every food and
 * recipe ever logged at one slot, ONE row each, most recently logged first (owner, 2026-10-29 —
 * "endless scroll, in order of recent"). No window: a 45-day cut-off left the owner's breakfast
 * shelf empty after a seven-week gap in logging.
 *
 * The coach's "usual breakfast" is a different question (how OFTEN) and stays on tallyUsual.
 * A bracket saved to the cookbook counts as its recipe, its members not again as loose foods —
 * the same rule tallyUsual follows (owner, 2026-09-08: the named latte comes back as a recipe).
 * Items never matched to a saved food have no id to put on a tile, so they are skipped.
 */
import type { MealKind, NutritionLog } from '@cadence/shared';

export interface RecentAtSlot {
  kind: 'food' | 'recipe';
  id: string;
  /** The date it was last logged at this slot (YYYY-MM-DD). */
  last_date: string;
  /** How many meals at this slot it appears in — all of history. */
  count: number;
}

/**
 * Newest date first. The sort is stable, so meals on one day keep the caller's order — the read
 * hands them over newest-written first (`order by date desc, created_at desc`).
 */
function newestFirst(a: NutritionLog, b: NutritionLog): number {
  return a.date === b.date ? 0 : a.date < b.date ? 1 : -1;
}

export function recentAtSlot(logs: NutritionLog[], meal: MealKind): RecentAtSlot[] {
  const seen = new Map<string, RecentAtSlot>();
  const order: RecentAtSlot[] = [];
  const add = (kind: 'food' | 'recipe', id: string, date: string) => {
    const key = `${kind}:${id}`;
    const prev = seen.get(key);
    if (prev) {
      prev.count += 1;
      return;
    }
    const row: RecentAtSlot = { kind, id, last_date: date, count: 1 };
    seen.set(key, row);
    order.push(row);
  };

  for (const log of logs.filter((l) => l.meal === meal).sort(newestFirst)) {
    // One meal counts each thing once, however many rows it has.
    const inThisMeal = new Set<string>();
    const once = (kind: 'food' | 'recipe', id: string) => {
      if (inThisMeal.has(`${kind}:${id}`)) return;
      inThisMeal.add(`${kind}:${id}`);
      add(kind, id, log.date);
    };
    if (log.recipe_id) {
      once('recipe', log.recipe_id);
      continue;
    }
    const recipeParts = new Set<string>();
    for (const part of log.parts ?? []) {
      if (!part.recipe_id) continue;
      recipeParts.add(part.key);
      once('recipe', part.recipe_id);
    }
    for (const item of log.items ?? []) {
      if (!item.food_id) continue;
      if (item.part && recipeParts.has(item.part)) continue;
      once('food', item.food_id);
    }
  }
  return order;
}

/** One page of the list. `cursor` is the offset of the first row; null means there is no more. */
export function pageOf<T>(rows: T[], cursor: number, limit: number): { items: T[]; next_cursor: string | null } {
  const items = rows.slice(cursor, cursor + limit);
  const next = cursor + items.length;
  return { items, next_cursor: next < rows.length ? String(next) : null };
}
