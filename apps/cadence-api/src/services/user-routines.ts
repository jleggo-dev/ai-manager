import { isGoalArea, type Activity, type GoalArea, type OccurrenceSession, type Plan } from '@cadence/shared';
import { getActivePlan } from '../repos/plans.ts';
import { getUserActivity } from '../repos/activities.ts';
import { getOrInsertOccurrenceId, setOccurrenceStatus } from '../repos/occurrences.ts';
import { setOccurrenceSession } from '../repos/occurrence-sessions.ts';
import { listLineageFinishCounts, type LineageFinishRow } from '../repos/routines.ts';
import {
  insertUserRoutine,
  listUserRoutinesRepo,
  getUserRoutineRow,
  updateUserRoutineRow,
  deleteUserRoutineRow,
  listActivitiesByIds,
  mintCompanionActivity,
  updateCompanionActivity,
  deleteFutureCompanionOccurrences,
  type UserRoutineRow,
  type UserRoutineProvenance,
} from '../repos/user-routines.ts';
import { normalizeSession } from './session-normalize.ts';
import { parseRecurrence, toRRule } from './scheduling.ts';
import { ensureHorizon, DEFAULT_HORIZON_DAYS } from './plan-horizon.ts';

/**
 * The user-routines store (Activity Builder wave 3) — "the coach's toolbox, handed to you."
 * Server side of the CONTRACT authored in apps/cadence-web/src/lib/api/user-routines.ts. A routine
 * is `cadence.user_routines` (0052) plus a lazily-minted COMPANION ACTIVITY: an ordinary
 * `cadence.activities` row, kind 'user', category 'user_built' (repos/activities.ts's
 * USER_BUILT_CATEGORY), that lets running and scheduling ride the existing occurrence/horizon/
 * consistency machinery unchanged rather than teaching it a second kind of "thing you can do."
 */

export type UserRoutineDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type UserRoutineTimeOfDay = 'morning' | 'evening' | 'anytime';
export interface UserRoutineScheduleInput {
  days: UserRoutineDay[];
  time_of_day?: UserRoutineTimeOfDay;
}
export interface UserRoutineView {
  routine_id: string;
  name: string;
  area?: GoalArea;
  session: OccurrenceSession;
  provenance: UserRoutineProvenance;
  created_at: string;
  updated_at: string;
  runs: number;
  last_run: string | null;
  schedule: UserRoutineScheduleInput | null;
}

/** A service call that failed for a reason the route must turn into a specific status: 404 (not
 *  this user's routine), 409 (no active plan to attach to), or 400 (a malformed session). Every
 *  write below returns one of these alongside `ok: true`, so the route never has to re-derive why. */
export interface ServiceFailure {
  ok: false;
  status: 404 | 409 | 400;
}

const DAY_BY_INDEX: UserRoutineDay[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const TIME_OF_DAY_VALUES: ReadonlySet<string> = new Set(['morning', 'evening', 'anytime']);

/** RRULE `BYDAY` → the client's day-chip vocabulary, or null when there's nothing schedulable
 *  (empty/unset recurrence, or a recurrence with no days — both read as "not on the plan"). */
function decodeSchedule(schedule: Activity['schedule']): UserRoutineScheduleInput | null {
  if (!schedule?.recurrence) return null;
  const { byday } = parseRecurrence(schedule.recurrence);
  const days = byday.map((n) => DAY_BY_INDEX[n]).filter((d): d is UserRoutineDay => !!d);
  if (days.length === 0) return null;
  const tod = schedule.time_of_day;
  return { days, ...(tod && TIME_OF_DAY_VALUES.has(tod) ? { time_of_day: tod as UserRoutineTimeOfDay } : {}) };
}

/** Row → wire shape, given the (already fetched) companion activity, active plan, and the whole
 *  user's finish-count table. `onPlan` requires BOTH a companion activity AND that activity's own
 *  plan being the CURRENTLY active one — a companion left behind on a superseded plan reads as
 *  off-plan (schedule: null) until the routine is run or scheduled again and gets re-minted. */
function toView(
  row: UserRoutineRow,
  activity: Activity | null,
  plan: Plan | null,
  finishByCommitment: Map<string, LineageFinishRow>,
): UserRoutineView {
  const onPlan = !!activity && !!plan && activity.plan_id === plan.plan_id;
  const finish = activity ? finishByCommitment.get(activity.commitment_id) : undefined;
  return {
    routine_id: row.routine_id,
    name: row.name,
    ...(row.area && isGoalArea(row.area) ? { area: row.area } : {}),
    session: row.session,
    provenance: row.provenance,
    created_at: row.created_at,
    updated_at: row.updated_at,
    runs: finish?.finishes ?? 0,
    last_run: finish?.last_done ?? null,
    schedule: onPlan ? decodeSchedule(activity.schedule) : null,
  };
}

/** A freshly-created routine never has a companion activity yet — no queries needed to know its
 *  runs/last_run/schedule are all zero/null. */
function toFreshView(row: UserRoutineRow): UserRoutineView {
  return toView(row, null, null, new Map());
}

/**
 * Everything the user has built, newest first — GET /me/routines. Three extra reads beyond the
 * routines themselves, each ONE query regardless of list size: the companion activities (bulk, by
 * id), the active plan (to tell an on-plan companion from a stale one), and the whole finish-count
 * table (reused verbatim from Activity Builder wave 1 — "by how often you finished them" is the
 * same honest signal here as it is for coach-built routines).
 */
export async function listUserRoutines(userId: string): Promise<UserRoutineView[]> {
  const [rows, plan, finishRows] = await Promise.all([
    listUserRoutinesRepo(userId),
    getActivePlan(userId),
    listLineageFinishCounts(userId),
  ]);
  const finishByCommitment = new Map(finishRows.map((r) => [r.commitment_id, r]));
  const activityIds = rows.map((r) => r.activity_id).filter((id): id is string => !!id);
  const activities = await listActivitiesByIds(userId, activityIds);
  const activityById = new Map(activities.map((a) => [a.activity_id, a]));
  return rows.map((row) =>
    toView(row, row.activity_id ? (activityById.get(row.activity_id) ?? null) : null, plan, finishByCommitment),
  );
}

/** Save a newly built routine. `null` = the session didn't normalize to anything usable (route →
 *  400) — name/area/provenance are already body-validated before this runs. */
export async function createUserRoutine(
  userId: string,
  input: { name: string; area?: GoalArea; session: unknown; provenance: UserRoutineProvenance },
): Promise<UserRoutineView | null> {
  const session = normalizeSession((input.session ?? null) as Record<string, unknown> | null);
  if (!session) return null;
  const row = await insertUserRoutine(userId, {
    name: input.name,
    area: input.area ?? null,
    session,
    provenance: input.provenance,
  });
  return toFreshView(row);
}

/**
 * Edit name/steps. Future occurrences follow (a PATCHed name re-titles the companion activity, so
 * anything still to come shows the new name); logged history is untouched — nothing here rewrites
 * an occurrence's own cached session (the food-diary rule).
 */
export async function updateUserRoutine(
  userId: string,
  routineId: string,
  patch: { name?: string; session?: unknown },
): Promise<{ ok: true; routine: UserRoutineView } | ServiceFailure> {
  const existing = await getUserRoutineRow(userId, routineId);
  if (!existing) return { ok: false, status: 404 };

  let session: OccurrenceSession | undefined;
  if (patch.session !== undefined) {
    const normalized = normalizeSession(patch.session as Record<string, unknown> | null);
    if (!normalized) return { ok: false, status: 400 };
    session = normalized;
  }
  const name = typeof patch.name === 'string' ? patch.name.trim() : undefined;
  if (name === '') return { ok: false, status: 400 };

  const updated = await updateUserRoutineRow(userId, routineId, { name: name || undefined, session });
  if (!updated) return { ok: false, status: 404 };

  if (name && existing.activity_id) {
    await updateCompanionActivity(userId, existing.activity_id, { title: name });
  }

  const [activity, plan, finishRows] = await Promise.all([
    updated.activity_id ? getUserActivity(userId, updated.activity_id) : Promise.resolve(null),
    getActivePlan(userId),
    listLineageFinishCounts(userId),
  ]);
  const finishByCommitment = new Map(finishRows.map((r) => [r.commitment_id, r]));
  return { ok: true, routine: toView(updated, activity, plan, finishByCommitment) };
}

/**
 * Delete the routine row. History SURVIVES — the companion activity and every occurrence it ever
 * logged stay exactly as they are — but its recurrence reverts to '' AND its future PENDING
 * occurrences are removed, the same slot cleanup `unscheduleUserRoutine` does. The design's own
 * delete-confirm copy is the spec: "The N sessions you logged with it stay in your history. If
 * it's on the plan, those slots open up." — a scheduled routine's still-to-come days must actually
 * open up, not sit on the trail as ghost tasks for a routine that no longer exists to run.
 * Not-found is `false`, same as everywhere else.
 */
export async function deleteUserRoutine(userId: string, routineId: string): Promise<boolean> {
  const routine = await getUserRoutineRow(userId, routineId);
  if (!routine) return false;
  if (routine.activity_id) {
    await updateCompanionActivity(userId, routine.activity_id, { schedule: { recurrence: '' } });
    const today = new Date().toISOString().slice(0, 10);
    await deleteFutureCompanionOccurrences(userId, routine.activity_id, today);
  }
  return deleteUserRoutineRow(userId, routineId);
}

/**
 * Find (lazily mint, or RE-mint) this routine's companion activity on the CURRENTLY active plan.
 * Three cases: never minted (first run/schedule — mint fresh); minted and still on the active plan
 * (use it as-is); minted on a plan that has since been superseded (mint again on the new active
 * plan, carrying the SAME commitment_id forward so the run/finish lineage stays one continuous
 * thing — Activity Builder wave 1's whole reason `commitment_id` survives a replan). Null when
 * there's no active plan at all — nothing to attach a companion to yet.
 */
async function ensureCompanionActivity(
  userId: string,
  routine: UserRoutineRow,
): Promise<{ activityId: string; plan: Plan } | null> {
  const plan = await getActivePlan(userId);
  if (!plan) return null;

  const existing = routine.activity_id ? await getUserActivity(userId, routine.activity_id) : null;
  if (existing && existing.plan_id === plan.plan_id) return { activityId: existing.activity_id, plan };

  const minted = await mintCompanionActivity(
    userId,
    plan.plan_id,
    routine.routine_id,
    routine.name,
    existing?.commitment_id,
  );
  return { activityId: minted.activity_id, plan };
}

/**
 * Credit one completed run (POST /me/routines/:id/run) — a done occurrence TODAY on the companion
 * activity, session written onto it unconditionally (`setOccurrenceSession`, not the write-once
 * cache guard: a run's session IS the record of what was actually played, and re-running same-day
 * must overwrite with whatever the routine currently holds). Rides the ordinary occurrence path —
 * `getOrInsertOccurrenceId` is idempotent per (activity, date), so a same-day re-run lands on the
 * SAME occurrence rather than a second one.
 */
export async function runUserRoutine(userId: string, routineId: string): Promise<{ ok: true } | ServiceFailure> {
  const routine = await getUserRoutineRow(userId, routineId);
  if (!routine) return { ok: false, status: 404 };
  const companion = await ensureCompanionActivity(userId, routine);
  if (!companion) return { ok: false, status: 409 };

  const today = new Date().toISOString().slice(0, 10);
  const occurrenceId = await getOrInsertOccurrenceId(companion.activityId, userId, today);
  await setOccurrenceSession(userId, occurrenceId, routine.session);
  await setOccurrenceStatus(userId, occurrenceId, 'done');
  return { ok: true };
}

/**
 * "Put it on the plan" (POST /me/routines/:id/schedule) — deterministic, no generation anywhere:
 * `toRRule` (services/scheduling.ts, the SAME encoder every synthesized/edited schedule already
 * goes through) turns the day chips into an RRULE, `ensureHorizon` (the same call plan commits
 * make) materializes this week's remaining occurrences for it. 409 when there's no active plan to
 * attach the companion to.
 */
export async function scheduleUserRoutine(
  userId: string,
  routineId: string,
  schedule: UserRoutineScheduleInput,
): Promise<{ ok: true } | ServiceFailure> {
  const routine = await getUserRoutineRow(userId, routineId);
  if (!routine) return { ok: false, status: 404 };
  const companion = await ensureCompanionActivity(userId, routine);
  if (!companion) return { ok: false, status: 409 };

  const recurrence = toRRule({ days: schedule.days });
  await updateCompanionActivity(userId, companion.activityId, {
    title: routine.name,
    schedule: { recurrence, time_of_day: schedule.time_of_day },
  });
  await ensureHorizon(userId, companion.plan.horizon_days ?? DEFAULT_HORIZON_DAYS);
  return { ok: true };
}

/**
 * Take it off the plan (DELETE /me/routines/:id/schedule): recurrence reverts to '' so nothing new
 * materializes, and only FUTURE PENDING occurrences on the companion are removed — logged history
 * is immutable. A routine that was never run or scheduled has no companion to revert; that's an
 * idempotent success, not a failure (there was nothing on the plan to begin with).
 */
export async function unscheduleUserRoutine(userId: string, routineId: string): Promise<{ ok: true } | ServiceFailure> {
  const routine = await getUserRoutineRow(userId, routineId);
  if (!routine) return { ok: false, status: 404 };
  if (!routine.activity_id) return { ok: true };

  await updateCompanionActivity(userId, routine.activity_id, { schedule: { recurrence: '' } });
  const today = new Date().toISOString().slice(0, 10);
  await deleteFutureCompanionOccurrences(userId, routine.activity_id, today);
  return { ok: true };
}
