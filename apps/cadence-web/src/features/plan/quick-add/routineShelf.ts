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

/** How many of a tier's playable routines the shelf shows before "Browse all N ›" takes over —
 *  applies per tier (coach routines, then user routines), not to the section as a whole. */
export const SHELF_ROUTINE_SLOTS = 2;

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
 * The rows ONE tier contributes to the shelf: its own playable list (the API's own order — never
 * re-sorted, the caller's job is to trust it), sliced to `SHELF_ROUTINE_SLOTS`, then trimmed
 * further so it never spends more than `slotsRemaining` — whatever earlier tiers (now-menu rows,
 * then coach routines, then user routines, in that listed order) left unclaimed. Callers thread
 * the remainder from one tier's `.length` into the next tier's `slotsRemaining`, so the shared
 * 5-row cap (`SHELF_ROW_CAP`) is never exceeded no matter how many tiers are stacked.
 */
export function fillShelfSlots<T>(playable: T[], slotsRemaining: number): T[] {
  return playable.slice(0, Math.max(0, Math.min(SHELF_ROUTINE_SLOTS, slotsRemaining)));
}

/**
 * The honest total to name in "Browse all N ›" — always the FULL playable count across every
 * tier, never just the remainder hidden by the cap, so the row never undercounts what browsing
 * actually reveals. `null` when nothing is hidden (every playable routine, of every tier, is
 * already shown), so the row has nothing to add.
 */
export function browseAllCount(totalPlayable: number, totalShown: number): number | null {
  return totalPlayable > totalShown ? totalPlayable : null;
}

/**
 * "finished 11 times · 32 min · from Cadence" — every clause appears only when it's real:
 * `finishes` of 0 makes no claim (never "finished 0 times"), `duration_min` is absent for a
 * routine that isn't on the active plan today (`PlanRoutine.duration_min`'s own doc comment).
 * Every one of these routines IS coach-built, so "from Cadence" always closes the line — the
 * "Yours" tier (user-built routines, Activity Builder wave 3) gets its own meta composer,
 * `userRoutineMeta` (userRoutineShelf.ts), with no provenance word: it's already under its own
 * "Yours" heading.
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
