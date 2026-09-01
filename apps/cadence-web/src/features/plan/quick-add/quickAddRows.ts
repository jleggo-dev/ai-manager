import type { NutritionDayData, PlanViewData } from '../../../lib/api.ts';

/**
 * What the ＋ sheet offers — derived from what the user ALREADY tracks, never a menu of
 * hypotheticals (owner, 2026-09-01). Two rules, both enforced here:
 *
 *   1. A row appears only when its tracking signal is live: water needs a pour in the trailing
 *      window, a meal needs recent food, a weight needs a weigh-in on the plan, a workout needs a
 *      movement commitment, a photo needs the opt-in. No signal, no row — the sheet must never
 *      invite someone to start tracking something from a quick-add menu.
 *   2. Nothing the plan already gives a button for: the old sheet listed every plan activity to
 *      tick, which duplicated the trail's own rows. The weight row applies the same rule per-day —
 *      on a day the trail carries a weigh-in of its own, quick add stands down.
 *
 * Pure derivation, no fetching: the sheet hands in whatever it holds, and every absent input is a
 * no-claim (no row), never a hint.
 */

export type QuickAddArea = 'movement' | 'practice';

export type QuickAddRow =
  | { kind: 'water' }
  | { kind: 'meal' }
  | { kind: 'weight' }
  /** An off-plan add for an area the plan shows they work in — `toward` names the goal when the
   *  area has exactly one, so "Add a practice · toward Learn piano" can say what it feeds. */
  | { kind: 'add'; area: QuickAddArea; toward?: string }
  | { kind: 'photo' };

/** Same reading CaptureSheet uses — a weigh row is named, not flagged. */
const isWeighTitle = (t: string) => /weigh/i.test(t);

export function deriveQuickAddRows(input: {
  plan: PlanViewData | null;
  day: NutritionDayData | null;
  photosEnabled: boolean;
}): QuickAddRow[] {
  const { plan, day, photosEnabled } = input;
  const rows: QuickAddRow[] = [];

  if (day?.has_recent_water === true) rows.push({ kind: 'water' });
  if (day?.has_recent_food === true) rows.push({ kind: 'meal' });

  if (plan) {
    const tracksWeight = plan.activities.some((a) => a.kind === 'system' && isWeighTitle(a.title));
    const todayHasWeighRow = (plan.week ?? []).some(
      (d) => d.isToday && d.occurrences.some((o) => isWeighTitle(o.title)),
    );
    if (tracksWeight && !todayHasWeighRow) rows.push({ kind: 'weight' });

    for (const area of ['movement', 'practice'] as const) {
      const inArea = plan.activities.filter((a) => a.kind === 'user' && a.area === area);
      if (inArea.length === 0) continue;
      const goals = [...new Set(inArea.map((a) => a.goal_title).filter((t): t is string => !!t))];
      rows.push({ kind: 'add', area, toward: goals.length === 1 ? goals[0] : undefined });
    }
  }

  if (photosEnabled) rows.push({ kind: 'photo' });
  return rows;
}
