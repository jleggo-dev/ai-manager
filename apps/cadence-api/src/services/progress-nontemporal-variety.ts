/**
 * `variety` — breadth ("14 different dinners this month"), docs/cadence/PROGRESS-ENGINE.md W1-5.
 *
 * Contract friction (see the parcel's final report): the design doc binds this to
 * `food_usage_ctx`, but that table is an all-time (user, food, weekday, meal) histogram — it
 * carries a `use_count` that has never been reset and a single `last_used_at`, with no per-log
 * date, so it structurally cannot answer a "this month" window (only "on Wednesdays", forever).
 * `cadence.nutrition_logs` DOES carry the date this widget needs and already has a ranged repo
 * read (`listNutritionLogs`, unchanged here) — so this resolver counts distinct foods there
 * instead, filtered to one meal in the window. Flagged for the composer/W1-6 to confirm.
 */
import type { MealKind, NutritionLog, VarietyPayload, WidgetOmission } from '@cadence/shared';
import { listNutritionLogs } from '../repos/nutrition.ts';
import { omit } from './progress-window.ts';

const MEAL_NOUN: Record<MealKind, string> = {
  breakfast: 'different breakfasts',
  lunch: 'different lunches',
  dinner: 'different dinners',
  snack: 'different snacks',
  drink: 'different drinks',
  other: 'different meals',
};

/** Pure: fold already-fetched (windowed) logs into one meal's distinct-food count. */
export function resolveVariety(logs: NutritionLog[], meal: MealKind, windowLabel: string): VarietyPayload | WidgetOmission {
  const slice = logs.filter((l) => l.meal === meal);
  if (slice.length === 0) return omit(`variety:${meal}`, 'variety', `no ${meal} logs in this window`);
  const foods = new Set<string>();
  for (const log of slice) {
    for (const item of log.items ?? []) {
      const key = (item.food_id ?? item.name ?? '').trim().toLowerCase();
      if (key) foods.add(key);
    }
  }
  if (foods.size === 0) return omit(`variety:${meal}`, 'variety', `${meal} logs in this window have no items`);
  return { count: foods.size, noun: MEAL_NOUN[meal], window_label: windowLabel };
}

/** Fetch + resolve for one user's window + meal slot. */
export async function getVariety(
  userId: string,
  meal: MealKind,
  fromDate: string,
  toDate: string,
  windowLabel: string,
): Promise<VarietyPayload | WidgetOmission> {
  const logs = await listNutritionLogs(userId, fromDate, toDate);
  return resolveVariety(logs, meal, windowLabel);
}
