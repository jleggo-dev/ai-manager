import type { MealItem, MealPart, MealState } from '@cadence/shared';
import type { Meal, MealMacros } from '../../lib/api.ts';
import { collapsedSub, looseItems, makesSeveral, orderedRows, partLabel, sumEst } from '../food/bracket/partModel.ts';

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
  /** The numbers are still being looked up on the web — see useMealEnrichment. */
  pending?: boolean;
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

function rowsForMeal(m: Meal): DiaryRow[] {
  const out: DiaryRow[] = [];
  // A meal whose vendor-named food is still being looked up. Said quietly on the row rather than
  // as a spinner over the day: what is on screen is real, it is simply about to get better.
  const pending = m.flags?.needs_enrich === true && m.flags?.enriched !== true;
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
      ...(pending ? { pending: true } : {}),
    });
    return out;
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
      ...(pending && !item.food_id ? { pending: true } : {}),
    });
  });
  return out;
}

export function diaryRows(meals: Meal[]): DiaryRow[] {
  return meals.flatMap(rowsForMeal);
}

/* ── The bracket, read back (meal-logging rework P6, canvas A4) ──────────────────────────────── */

/**
 * What the day-read actually sends, one shape wider than lib/api's `Meal` declares. The endpoint
 * returns the stored row verbatim, so `parts`, `state`, `recipe_id` and each item's `part` pointer
 * all arrive at runtime — the API type simply predates the rework. lib/api is the contract and is
 * consumed, not edited, so the diary widens the type on its own side of the read. Every added
 * field is optional: a `Meal` IS a `DiaryMeal`, no cast needed at the call sites.
 */
export type DiaryMeal = Omit<Meal, 'items'> & {
  items: (Meal['items'][number] & { part?: string })[];
  parts?: MealPart[] | null;
  state?: MealState;
  recipe_id?: string | null;
};

/** A bracket in the diary: one collapsed row that expands to its member rows, addresses intact. */
export interface DiaryPartGroup {
  kind: 'part';
  key: string;
  logId: string;
  /** The server part key — or null for the legacy `recipe_id` adapter, which has no part to
   *  address, so it reads but takes no ops. */
  partKey: string | null;
  label: string;
  /** The given name only — null when the label is a plain count ("4 things"). */
  partName: string | null;
  /** The collapsed second line: "4 things", or "1 of 4 servings" when the yield says so. */
  sub: string;
  yieldServings: number | null;
  memberCount: number;
  kcal: number | null;
  /** Butter bracket — the part makes several portions. */
  several: boolean;
  inCookbook: boolean;
  rows: DiaryRow[];
}

export type DiaryGroup = { kind: 'item'; key: string; row: DiaryRow } | DiaryPartGroup;

/**
 * The legacy positional convention, detected reader-side (no data change, ever): before parts,
 * `logMealFromRecipe` wrote `recipe_id` on the log and item[0] = the recipe itself
 * ({name, qty: servings, unit: 'serving'}, carrying the scaled macros) followed by bare
 * ingredient rows. Such a log renders AS IF it were one part named by item[0] — and the expanded
 * rows are exactly the flat rows, so every logId+index correction address still works.
 */
export function isLegacyRecipeLog(meal: Meal): boolean {
  const m = meal as DiaryMeal;
  const first = m.items?.[0];
  return (
    typeof m.recipe_id === 'string' &&
    m.recipe_id.length > 0 &&
    !(m.parts && m.parts.length > 0) &&
    !!first &&
    first.unit === 'serving' &&
    typeof first.qty === 'number'
  );
}

const roundOrNull = (v: number | undefined): number | null => (typeof v === 'number' ? Math.round(v) : null);

/**
 * The grouped read behind frame A4: rows belonging to a part become ONE collapsed bracket row
 * (name or "N things" · member count · part kcal) that expands in place; loose items pass through
 * untouched. Grouping changes no numbers — this is only how the day reads back, so the flat
 * `diaryRows` totals and the grouped view always agree.
 */
export function diaryGroups(meals: Meal[]): DiaryGroup[] {
  const out: DiaryGroup[] = [];
  for (const meal of meals) {
    const m = meal as DiaryMeal;
    const rows = rowsForMeal(meal);
    if (!m.items?.length) {
      const row = rows[0];
      if (row) out.push({ kind: 'item', key: row.key, row });
      continue;
    }
    if (isLegacyRecipeLog(meal)) {
      out.push({
        kind: 'part',
        key: `${m.log_id}-recipe`,
        logId: m.log_id,
        partKey: null,
        label: m.items[0]?.name || 'meal',
        partName: m.items[0]?.name || null,
        // No yield lives on the legacy row, so never "1 of N" here — the count is honest instead.
        sub: rows.length === 1 ? '1 thing' : `${rows.length} things`,
        yieldServings: null,
        memberCount: rows.length,
        kcal: roundOrNull(m.items[0]?.est?.kcal ?? m.macros?.kcal),
        several: false,
        inCookbook: true,
        rows,
      });
      continue;
    }
    const parts = m.parts ?? [];
    for (const r of orderedRows(m.items as MealItem[], parts)) {
      if (r.kind === 'item') {
        const row = rows[r.index];
        if (row) out.push({ kind: 'item', key: row.key, row });
        continue;
      }
      out.push({
        kind: 'part',
        key: `${m.log_id}-${r.part.key}`,
        logId: m.log_id,
        partKey: r.part.key,
        label: partLabel(r.part, r.memberIndexes.length),
        partName: r.part.name ?? null,
        sub: collapsedSub(r.part, r.memberIndexes.length),
        yieldServings: r.part.yield_servings ?? null,
        memberCount: r.memberIndexes.length,
        kcal: roundOrNull(sumEst(m.items as MealItem[], r.memberIndexes).kcal),
        several: makesSeveral(r.part),
        inCookbook: typeof r.part.recipe_id === 'string' && r.part.recipe_id.length > 0,
        rows: r.memberIndexes.map((i) => rows[i]).filter((x): x is DiaryRow => !!x),
      });
    }
  }
  return out;
}

/** Item indexes outside every bracket — what "Group things" can offer. Legacy reads offer none. */
export function looseIndexesOf(meal: Meal): number[] {
  const m = meal as DiaryMeal;
  if (!m.items?.length || isLegacyRecipeLog(meal)) return [];
  return looseItems(m.items as MealItem[], m.parts ?? []);
}

/** An open meal is already in the day's totals (server ruling) — the diary only says so. */
export function isMealOpen(meal: Meal): boolean {
  return (meal as DiaryMeal).state === 'open';
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
