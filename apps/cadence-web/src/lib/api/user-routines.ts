import type { OccurrenceSession } from '@cadence/shared';
import { BASE, headers } from './http.ts';

/**
 * Your activities (Activity Builder wave 3) — the routines the USER builds, as opposed to the
 * coach-built lineages `/plan/routines` lists. This file is the wave's CONTRACT, authored at
 * integration before the parcels: the server (W3-1) implements these routes verbatim; the builder
 * (W3-2), Settings (W3-3) and the ＋ sheet (W3-4) consume these functions verbatim. A user-built
 * activity is the same `OccurrenceSession` data the coach emits — same player, same honest logs,
 * no second runtime (the design's first law).
 *
 * Failure honesty, same as the rest of this API layer: a read returns `null` when it could not
 * load — never an empty list; writes return `null`/`ok:false` on failure and the surface says so.
 */

export interface UserRoutineProvenance {
  kind: 'blank' | 'from_cadence' | 'from_recap';
  /** Set when `kind` is 'from_cadence': the coach lineage this was copied from. The copy is the
   *  user's from that moment — she keeps adapting HER routine, never this one. */
  source_commitment_id?: string;
}

/** Day keys for deterministic scheduling — Monday-first, matching the week the plan draws. */
export type UserRoutineDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface UserRoutineSchedule {
  days: UserRoutineDay[];
  time_of_day?: 'morning' | 'evening' | 'anytime';
}

export interface UserRoutine {
  routine_id: string;
  name: string;
  area?: 'movement' | 'nourishment' | 'mind' | 'practice';
  /** The built steps — the full session the player runs, not a summary. */
  session: OccurrenceSession;
  provenance: UserRoutineProvenance;
  created_at: string;
  updated_at: string;
  /** Completed runs (done occurrences via its companion activity). 0 is honest, never invented. */
  runs: number;
  last_run: string | null;
  /** Its place on the active plan, or null when it's library-only. */
  schedule: UserRoutineSchedule | null;
}

/** Everything the user has built, newest first. `null` = couldn't load (never "you have none"). */
export async function listUserRoutines(): Promise<UserRoutine[] | null> {
  const res = await fetch(`${BASE}/me/routines`, { headers: headers() }).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json()) as { routines: UserRoutine[] };
  return body.routines;
}

/** Save a newly built routine. `null` on failure — the save moment says so and keeps the draft. */
export async function createUserRoutine(input: {
  name: string;
  area?: UserRoutine['area'];
  session: OccurrenceSession;
  provenance: UserRoutineProvenance;
}): Promise<UserRoutine | null> {
  const res = await fetch(`${BASE}/me/routines`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(input),
  }).catch(() => null);
  if (!res?.ok) return null;
  return (await res.json()) as UserRoutine;
}

/** Edit name/steps. Future occurrences follow; logged history is immutable (the food-diary rule). */
export async function updateUserRoutine(
  routineId: string,
  patch: { name?: string; session?: OccurrenceSession },
): Promise<UserRoutine | null> {
  const res = await fetch(`${BASE}/me/routines/${encodeURIComponent(routineId)}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify(patch),
  }).catch(() => null);
  if (!res?.ok) return null;
  return (await res.json()) as UserRoutine;
}

/** Delete the routine. Logged sessions SURVIVE in history (which is why the confirm stays light);
 *  any plan slots it held open up. */
export async function deleteUserRoutine(routineId: string): Promise<boolean> {
  const res = await fetch(`${BASE}/me/routines/${encodeURIComponent(routineId)}`, {
    method: 'DELETE',
    headers: headers(),
  }).catch(() => null);
  return !!res?.ok;
}

/** Credit one completed off-plan run (the player finished) — a done occurrence on its companion
 *  activity, counting toward consistency + the streak like any other session. */
export async function logUserRoutineRun(routineId: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/me/routines/${encodeURIComponent(routineId)}/run`, {
    method: 'POST',
    headers: headers(),
  }).catch(() => null);
  return { ok: !!res?.ok };
}

/** "Put it on the plan" — deterministic: day chips + a time-of-day written straight onto the
 *  active plan, no generation anywhere in the path. 409 (ok:false) when there's no active plan. */
export async function scheduleUserRoutine(routineId: string, schedule: UserRoutineSchedule): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/me/routines/${encodeURIComponent(routineId)}/schedule`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(schedule),
  }).catch(() => null);
  return { ok: !!res?.ok };
}

/** Take it off the plan; the routine itself stays in the library, history untouched. */
export async function unscheduleUserRoutine(routineId: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/me/routines/${encodeURIComponent(routineId)}/schedule`, {
    method: 'DELETE',
    headers: headers(),
  }).catch(() => null);
  return { ok: !!res?.ok };
}
