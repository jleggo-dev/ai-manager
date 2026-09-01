import { sql } from '../db/sql.ts';
import type { ActivitySchedule, OccurrenceSession } from '@cadence/shared';

/**
 * The read-side data behind GET /plan/routines (Activity Builder A3 — "the coach's sessions as
 * the template library", design-request-v2/activity-builder.txt §"2A · Build — start from"):
 * every USER-kind activity row a user has ever had, across every plan version, plus the two
 * occurrence-side facts a routine card needs — how often it's been finished, and its most
 * recently prescribed step list.
 *
 * Its own file rather than a growth spurt on activities.ts/occurrences.ts: both are already near
 * the 500-line size gate, and this is a genuinely new read shape — grouped by `commitment_id`
 * LINEAGE across every plan version, not by one plan's activities or one date window — that
 * neither file's existing queries share.
 */

export interface ActivityVersionRow {
  commitment_id: string;
  title: string;
  goal_id: string | null;
  schedule: ActivitySchedule;
  category: string | null;
  plan_id: string;
  plan_version: number;
  /** The row's OWN plan's status. 'active' marks the lineage's current, live schedule; a lineage
   *  whose newest row is 'superseded' is a routine from an earlier week — still theirs, but with
   *  no "current" schedule to show (services/routines.ts reads this to set `on_plan`). */
  plan_status: string;
}

/**
 * Every USER-kind activity row this user has ever committed, across ALL plan versions (active +
 * superseded — superseded rows are kept forever, see repos/plans.ts). One row per (commitment,
 * plan version); the caller groups by `commitment_id` and takes the newest `plan_version` as that
 * lineage's current state (services/routines.ts's `latestVersionByCommitment`).
 */
export async function listUserActivityVersions(userId: string): Promise<ActivityVersionRow[]> {
  return sql<ActivityVersionRow[]>`
    select a.commitment_id, a.title, a.goal_id, a.schedule, a.category,
           a.plan_id, p.version as plan_version, p.status as plan_status
    from cadence.activities a
    join cadence.plans p on p.plan_id = a.plan_id
    where a.user_id = ${userId} and a.kind = 'user'
    order by a.commitment_id, p.version desc`;
}

export interface LineageFinishRow {
  commitment_id: string;
  finishes: number;
  last_done: string | null;
}

/**
 * Done-occurrence count + most recent done date, grouped by commitment LINEAGE — summed across
 * every activity_id version that lineage has ever had (a replan mints a fresh activity_id, but
 * the history belongs to the same commitment). This is the design's explicit ranking signal:
 * "by how often you finished them, the honest signal, not recency."
 */
export async function listLineageFinishCounts(userId: string): Promise<LineageFinishRow[]> {
  return sql<LineageFinishRow[]>`
    select a.commitment_id, count(*)::int as finishes,
           to_char(max(o.date), 'YYYY-MM-DD') as last_done
    from cadence.occurrences o
    join cadence.activities a on a.activity_id = o.activity_id
    where a.user_id = ${userId} and a.kind = 'user' and o.status = 'done'
    group by a.commitment_id`;
}

export interface LineageSessionRow {
  commitment_id: string;
  session: OccurrenceSession;
}

/**
 * The most recently-DATED cached session for each commitment lineage (`distinct on` keeps one row
 * per lineage, newest occurrence date first) — the step list a routine card shows. A lineage that
 * has never had a session written (never opened, or cleared for revision and not yet regenerated)
 * is simply absent from the result; the caller's honest empty is `steps: []`, never an invented
 * list (see services/routines.ts's `stepNames`).
 */
export async function listLineageLatestSessions(userId: string): Promise<LineageSessionRow[]> {
  return sql<LineageSessionRow[]>`
    select distinct on (a.commitment_id) a.commitment_id, o.session
    from cadence.occurrences o
    join cadence.activities a on a.activity_id = o.activity_id
    where a.user_id = ${userId} and a.kind = 'user' and o.session is not null
    order by a.commitment_id, o.date desc`;
}
