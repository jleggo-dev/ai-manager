import { sql, json } from '../db/sql.ts';
import type { Activity, ActivitySchedule, OccurrenceSession } from '@cadence/shared';
import { insertActivities, USER_BUILT_CATEGORY } from './activities.ts';

/**
 * `cadence.user_routines` (0052) + the companion-activity plumbing on `cadence.activities` that
 * services/user-routines.ts drives — see the migration's header comment for the whole design.
 * Kept out of repos/activities.ts / repos/occurrences.ts: both are already near the 500-line size
 * gate, and every query here is specific to this one feature's read/write shapes.
 */

export interface UserRoutineProvenance {
  kind: 'blank' | 'from_cadence' | 'from_recap';
  source_commitment_id?: string;
}

export interface UserRoutineRow {
  routine_id: string;
  user_id: string;
  name: string;
  area: string | null;
  session: OccurrenceSession;
  provenance: UserRoutineProvenance;
  activity_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function insertUserRoutine(
  userId: string,
  fields: { name: string; area: string | null; session: OccurrenceSession; provenance: UserRoutineProvenance },
): Promise<UserRoutineRow> {
  const [row] = await sql<UserRoutineRow[]>`
    insert into cadence.user_routines (user_id, name, area, session, provenance)
    values (${userId}, ${fields.name}, ${fields.area}, ${json(fields.session)}, ${json(fields.provenance)})
    returning *`;
  if (!row) throw new Error('insertUserRoutine: no row returned');
  return row;
}

/** Newest first — the list route's whole ordering (`UserRoutine[] | null`, "newest first"). */
export async function listUserRoutinesRepo(userId: string): Promise<UserRoutineRow[]> {
  return sql<UserRoutineRow[]>`
    select * from cadence.user_routines where user_id = ${userId} order by created_at desc`;
}

/** Ownership-checked; null when it isn't this user's (route → 404, no leak). */
export async function getUserRoutineRow(userId: string, routineId: string): Promise<UserRoutineRow | null> {
  const [row] = await sql<UserRoutineRow[]>`
    select * from cadence.user_routines where user_id = ${userId} and routine_id = ${routineId} limit 1`;
  return row ?? null;
}

/** Patch name/session — the ONLY two fields the client contract's PATCH accepts. Whole-column
 *  jsonb write for `session` (never a merge — same stance every ActivitySchedule write in this
 *  codebase takes). Null return = not this user's (route → 404). */
export async function updateUserRoutineRow(
  userId: string,
  routineId: string,
  fields: { name?: string; session?: OccurrenceSession },
): Promise<UserRoutineRow | null> {
  const [row] = await sql<UserRoutineRow[]>`
    update cadence.user_routines set
      name = coalesce(${fields.name ?? null}, name),
      session = coalesce(${fields.session ? json(fields.session) : null}, session),
      updated_at = now()
    where user_id = ${userId} and routine_id = ${routineId}
    returning *`;
  return row ?? null;
}

export async function deleteUserRoutineRow(userId: string, routineId: string): Promise<boolean> {
  const res = await sql`delete from cadence.user_routines where user_id = ${userId} and routine_id = ${routineId}`;
  return res.count > 0;
}

/** Bulk-fetch companion activities by id, ownership-scoped — the list route's one extra query
 *  instead of N (one per routine). Empty input short-circuits (postgres.js chokes on `= any('{}')`
 *  less than on skipping the round trip entirely). */
export async function listActivitiesByIds(userId: string, activityIds: string[]): Promise<Activity[]> {
  if (activityIds.length === 0) return [];
  return sql<
    Activity[]
  >`select * from cadence.activities where user_id = ${userId} and activity_id = any(${activityIds})`;
}

/**
 * Mint a routine's companion activity — kind 'user', category USER_BUILT_CATEGORY, schedule
 * `{recurrence: ''}` (the adhoc-bucket trick: an empty recurrence is never picked up by
 * `ensureHorizon`, which only expands non-empty ones). Passing `commitmentId` re-mints an existing
 * lineage on a new active plan instead of starting a fresh one — the run/finish history a
 * `commitment_id` carries (Activity Builder wave 1) survives a replan the same way any coach-built
 * commitment's does. Atomic: the activities insert and the routine's `activity_id` pointer land
 * together, so a crash between them can't orphan either one.
 */
export async function mintCompanionActivity(
  userId: string,
  planId: string,
  routineId: string,
  title: string,
  commitmentId?: string,
): Promise<Activity> {
  return sql.begin(async (tx) => {
    const [activity] = await insertActivities(
      userId,
      planId,
      [
        {
          commitment_id: commitmentId,
          title,
          kind: 'user',
          category: USER_BUILT_CATEGORY,
          schedule: { recurrence: '' },
        },
      ],
      tx,
    );
    if (!activity) throw new Error('mintCompanionActivity: insert failed');
    await tx`
      update cadence.user_routines set activity_id = ${activity.activity_id}, updated_at = now()
      where user_id = ${userId} and routine_id = ${routineId}`;
    return activity;
  });
}

/** Whole-column title/schedule write on the companion activity — title on a PATCH (name edits
 *  follow through), schedule on a schedule/unschedule/delete (recurrence set or reverted to ''). */
export async function updateCompanionActivity(
  userId: string,
  activityId: string,
  fields: { title?: string; schedule?: ActivitySchedule },
): Promise<void> {
  await sql`
    update cadence.activities set
      title = coalesce(${fields.title ?? null}, title),
      schedule = coalesce(${fields.schedule ? json(fields.schedule) : null}, schedule)
    where user_id = ${userId} and activity_id = ${activityId}`;
}

/** Unschedule's + delete's "remove only FUTURE pending occurrences" — logged history is immutable
 *  (the food-diary rule). Scoped to ONE activity, unlike `deleteFuturePendingOccurrences`
 *  (occurrences.ts), which is plan-wide — a routine going off the plan must not touch anything
 *  else on it. */
export async function deleteFutureCompanionOccurrences(
  userId: string,
  activityId: string,
  fromDate: string,
): Promise<number> {
  const res = await sql`
    delete from cadence.occurrences
    where user_id = ${userId} and activity_id = ${activityId} and date >= ${fromDate} and status = 'pending'`;
  return res.count;
}
