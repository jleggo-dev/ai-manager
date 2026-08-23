import type { Meal, MealMacros } from '../../lib/api.ts';

/**
 * One row per FOOD, flattened out of a slot's meals — the view model behind brief 04.
 *
 * The diary's rows used to be name + calories. The owner asked for the rest by way of a reason:
 * *"I should be able to see which foods are contributing to a high fat content for the day."*
 * That is a per-food question, and the day total cannot answer it — so the flattening has to keep
 * each item addressable, which is also what lets a row be opened and corrected (brief 05).
 *
 * `logId` and `index` travel with every row because they are the correction's address: an item is
 * identified by which meal it is on and where in that meal's list it sits.
 */
export interface DiaryRow {
  key: string;
  logId: string;
  /** Index into that meal's `items`, or null for a meal with no item breakdown at all. */
  index: number | null;
  name: string;
  brand: string | null;
  amount: string | null;
  macros: MealMacros | null;
}

/** "35.5 g", "1 cup", "2" — what they said, not what we inferred. Absent stays absent. */
export function amountText(qty: number | undefined, unit: string | undefined): string | null {
  if (typeof qty !== 'number' || !Number.isFinite(qty)) return unit?.trim() || null;
  const n = Math.round(qty * 10) / 10;
  return unit?.trim() ? `${n} ${unit.trim()}` : String(n);
}

/** The best name a meal can give itself when the parse never broke it into items. */
export function mealName(m: Meal): string {
  return (
    m.items
      ?.map((i) => i.name)
      .filter(Boolean)
      .join(', ') ||
    m.raw_text ||
    (m.photo_url ? 'photo' : 'meal')
  );
}

export function diaryRows(meals: Meal[]): DiaryRow[] {
  const out: DiaryRow[] = [];
  for (const m of meals) {
    if (!m.items?.length) {
      // A meal we never broke down still owns its numbers — it is one row carrying the whole meal.
      out.push({
        key: m.log_id,
        logId: m.log_id,
        index: null,
        name: mealName(m),
        brand: null,
        amount: null,
        macros: m.macros ?? null,
      });
      continue;
    }
    m.items.forEach((item, i) => {
      out.push({
        key: `${m.log_id}-${i}`,
        logId: m.log_id,
        index: i,
        name: item.name || 'item',
        brand: item.brand?.trim() || null,
        amount: amountText(item.qty, item.unit),
        macros: item.est ?? null,
      });
    });
  }
  return out;
}

/**
 * A number for a column, or null.
 *
 * Null is the whole point. Some items legitimately carry no numbers — a meal typed in words that
 * matched nothing — and a blank must never read as zero, because zero is a claim about the food
 * and a blank is a statement about us. The renderer draws "—" for null, never 0.
 */
export function cell(macros: MealMacros | null, key: keyof MealMacros): number | null {
  const v = macros?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
}
