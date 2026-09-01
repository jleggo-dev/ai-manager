import { deriveWalkthrough } from '@cadence/shared';
import type { UserRoutine } from '../../../lib/api.ts';

/**
 * Pure shaping for the "Yours" tier — the user's own built routines (Activity Builder wave 3) —
 * everywhere "Take me on one" and "Start from" need to know which are playable and what their
 * meta line says. Mirrors routineShelf.ts's shape for coach routines; kept as its own file because
 * a `UserRoutine` is a different type with different real facts (`runs`, not `finishes`; no
 * `duration_min` field — the session itself is the only source of a total).
 */

/**
 * A user-built routine with no steps at all can't play — the same "never render a dead row" rule
 * `playableRoutines` (routineShelf.ts) applies to coach routines. `routines` is nullable because
 * `listUserRoutines` draws the same distinction every read in this API layer does: `null` is "I
 * couldn't load your routines", `[]` is "you have none" — both collapse to `[]` here, a failed
 * load makes no claim rather than removing anything real.
 */
export function playableUserRoutines(routines: UserRoutine[] | null): UserRoutine[] {
  return (routines ?? []).filter((r) => r.session.blocks.some((b) => b.items.length > 0));
}

/**
 * "finished 6 times · 22 min" — real facts only, and no trailing provenance word: unlike a coach
 * routine's `routineMeta` (routineShelf.ts), a "Yours" row already sits under its own "Yours"
 * heading, so repeating that would be noise, not information. `runs` of 0 makes no claim (never
 * "finished 0 times"); the total comes from `deriveWalkthrough` since `UserRoutine` carries no
 * precomputed duration of its own — only the built session. `null` when neither fact is real
 * (a brand-new copy, zero-minute session): the row shows no meta line at all rather than an empty
 * one, the same `{meta && <span>...}` convention every other row in this sheet already follows.
 */
export function userRoutineMeta(routine: UserRoutine): string | null {
  const parts: string[] = [];
  if (routine.runs > 0) parts.push(`finished ${routine.runs} time${routine.runs === 1 ? '' : 's'}`);
  const totalMin = deriveWalkthrough(routine.session).total_min;
  if (totalMin > 0) parts.push(`${totalMin} min`);
  return parts.length > 0 ? parts.join(' · ') : null;
}
