import type { PlanRoutine } from '../../../lib/api.ts';

/**
 * Pure shaping for "Take me on one"'s routines half (Activity Builder 2A, screen 2) — which of the
 * user's coach-built routines are even playable, how many the shelf shows, and what their meta
 * line says. Split out from QuickAddTense.tsx so the ranking/capping rules (easy to get subtly
 * wrong — see each function's own note) are covered by direct unit tests, not only by mounting the
 * whole screen.
 */

/** The Now Door's own row cap (DoNowSection's section grammar), reused here so this section never
 *  grows past what any other Now Door surface already caps at. */
export const SHELF_ROW_CAP = 5;

/** How many of a lineage's playable routines the shelf shows before "Browse all N ›" takes over. */
const SHELF_ROUTINE_SLOTS = 2;

/**
 * A routine with no cached session (`steps: []`) can't play — DoNowSection's own "never render a
 * dead row" rule, reused here. `routines` is nullable because `getRoutines` draws the same
 * distinction `getPlan` does: `null` is "I couldn't load your routines", `[]` is "you have none" —
 * a caller that only wants playable rows treats a failed load as zero rows too (no claim), same as
 * a real empty list, so both collapse to `[]` here.
 */
export function playableRoutines(routines: PlanRoutine[] | null): PlanRoutine[] {
  return (routines ?? []).filter((r) => r.steps.length > 0);
}

/**
 * The rows the shelf actually shows: the API's own finishes-ranked order, sliced to the top 2
 * (never re-sorted — the caller's job is to trust that order), then trimmed further so
 * `nowMenuCount` now-menu rows plus these never exceed the Now Door's shared 5-row cap. Now-menu
 * rows always win the room — they're listed first in the section, so they claim their slots first.
 */
export function shelfRoutines(playable: PlanRoutine[], nowMenuCount: number): PlanRoutine[] {
  const slots = Math.max(0, SHELF_ROW_CAP - nowMenuCount);
  return playable.slice(0, Math.min(SHELF_ROUTINE_SLOTS, slots));
}

/**
 * The honest total to name in "Browse all N ›" — always the FULL playable count, never just the
 * remainder hidden by the cap, so the row never undercounts what browsing actually reveals. `null`
 * when nothing is hidden (every playable routine is already shown), so the row has nothing to add.
 */
export function browseAllCount(playable: PlanRoutine[], shown: PlanRoutine[]): number | null {
  return playable.length > shown.length ? playable.length : null;
}

/**
 * "finished 11 times · 32 min · from Cadence" — every clause appears only when it's real:
 * `finishes` of 0 makes no claim (never "finished 0 times"), `duration_min` is absent for a
 * routine that isn't on the active plan today (`PlanRoutine.duration_min`'s own doc comment).
 * Every one of these routines IS coach-built (the "yours" chip arrives with the builder wave), so
 * "from Cadence" always closes the line.
 */
export function routineMeta(routine: PlanRoutine): string {
  const parts: string[] = [];
  if (routine.finishes > 0) {
    parts.push(`finished ${routine.finishes} time${routine.finishes === 1 ? '' : 's'}`);
  }
  if (typeof routine.duration_min === 'number') parts.push(`${routine.duration_min} min`);
  parts.push('from Cadence');
  return parts.join(' · ');
}
