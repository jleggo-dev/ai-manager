import { isWeighInTitle } from '@cadence/shared';
import type { PlanOccurrence } from '../lib/api.ts';

// Matches the legacy single "Food log" AND the per-meal split tasks ("Log breakfast/lunch/snack/
// dinner") — none of which contain "food/meal", so the meal names are listed explicitly. Keeps meal
// tasks routing to the nutrition capture sheet + wearing the nutrition icon.
export const isFoodTitle = (t: string) => /food|meal|nutrition|breakfast|lunch|dinner|snack/i.test(t);
/**
 * The shared matcher, re-exported under the name the app already uses. It was `/weigh/i` here,
 * which sent "Weighted hill intervals" to the scale sheet (owner, 2026-09-01) — the server has
 * the same rule from the same import, so the two can no longer disagree about what a tap opens.
 */
export const isWeighTitle = isWeighInTitle;

export type OccMod = 'nutrition' | 'weigh' | 'session';

export function occMod(o: PlanOccurrence): OccMod {
  if (isFoodTitle(o.title)) return 'nutrition';
  if (isWeighTitle(o.title)) return 'weigh';
  return 'session';
}

/** User rows + weigh-in / food-log system rows open a capture/session sheet. */
export function isOccurrenceOpenable(o: PlanOccurrence): boolean {
  return o.kind === 'user' || isFoodTitle(o.title) || isWeighTitle(o.title);
}
