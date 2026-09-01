import { isGoalArea, type GoalArea, type OccurrenceSession } from '@cadence/shared';
import { listGoals } from '../repos/goals.ts';
import { NON_PLAN_CATEGORIES } from '../repos/activities.ts';
import {
  listUserActivityVersions,
  listLineageFinishCounts,
  listLineageLatestSessions,
  type ActivityVersionRow,
} from '../repos/routines.ts';
import { describeRecurrence } from './scheduling.ts';

/**
 * GET /plan/routines' data (Activity Builder A3 — "the coach's sessions as the template
 * library"): the user's coach-built routines, grouped by `commitment_id` LINEAGE across every
 * plan version they've ever ridden, ranked "by how often you finished them, the honest signal,
 * not recency" (design-request-v2/activity-builder.txt §"2A · Build — start from").
 */
export interface Routine {
  commitment_id: string;
  title: string;
  /** The linked goal's area — absent when the commitment carries no goal link, same as
   *  PlanViewActivity/PlanActivity elsewhere (plan-view.ts). */
  area?: GoalArea;
  /** Humanized cadence, e.g. "Every other day" (services/scheduling.ts's `describeRecurrence`) —
   *  only present when this lineage is ON the active plan today. An off-plan routine has no
   *  "current" schedule to show. */
  cadence?: string;
  /** Minutes of the EFFORT (not the whole session — see ActivitySchedule.duration_min), from the
   *  active plan's row. Same on_plan-only rule as `cadence`. */
  duration_min?: number;
  /** Step names from the most recently prescribed session for this lineage. An honest empty
   *  ([]) when no session has ever been cached for it — never invented. */
  steps: string[];
  /** Count of `done` occurrences across every plan version this lineage has ever had — the
   *  ranking signal. */
  finishes: number;
  /** ISO date (YYYY-MM-DD) of the newest `done` occurrence, or null if it's never been finished. */
  last_done: string | null;
  /** Is this lineage part of the CURRENTLY active plan? False for a routine from weeks ago the
   *  user hasn't been asked to do since — still theirs, so still listed (never dropped). */
  on_plan: boolean;
}

/** Item names from a session's blocks, in order — the "short step-name list" a routine card
 *  shows. Deliberately just names (not `detail`/quantities/tool config): this is a template
 *  summary, not the full prescription (GET /plan/occurrences/:id already covers that in full). */
function stepNames(session: OccurrenceSession | undefined): string[] {
  if (!session) return [];
  const out: string[] = [];
  for (const block of session.blocks ?? []) {
    for (const item of block.items ?? []) {
      if (item.name) out.push(item.name);
    }
  }
  return out;
}

/**
 * The newest-per-commitment row out of a (possibly unsorted, possibly multi-version) list of
 * activity rows — a lineage's CURRENT state: whichever plan version most recently touched it,
 * active or superseded. Exported so the grouping rule itself — not just its end-to-end effect —
 * has a direct test; the route only ever needs `listRoutines`.
 */
export function latestVersionByCommitment(rows: ActivityVersionRow[]): Map<string, ActivityVersionRow> {
  const out = new Map<string, ActivityVersionRow>();
  for (const row of rows) {
    const current = out.get(row.commitment_id);
    if (!current || row.plan_version > current.plan_version) out.set(row.commitment_id, row);
  }
  return out;
}

/** Query-param → GoalArea, or undefined for "no filter". An unrecognized value (a stale/typo'd
 *  area, or nothing sent) is treated the same as absent rather than erroring the whole read. */
export function parseAreaParam(value: unknown): GoalArea | undefined {
  return isGoalArea(value) ? value : undefined;
}

/**
 * The user's coach-built routines: plan activities grouped by `commitment_id` lineage across
 * every plan version, each with its area, current schedule (when still on the active plan), most
 * recent step list, finish count and last-done date. Sorted by `finishes` desc, then `last_done`
 * desc. Includes lineages that are NOT on the active plan (`on_plan: false`) — a routine from
 * three weeks ago is still theirs. A lineage counts as a routine only when its LATEST version is
 * `kind = 'user'` — `kind` (like category) can change between versions, so the CURRENT row
 * decides, never an older one (see `listUserActivityVersions` in repos/routines.ts).
 */
export async function listRoutines(userId: string, area?: GoalArea): Promise<Routine[]> {
  const [versions, finishRows, sessionRows, goals] = await Promise.all([
    listUserActivityVersions(userId),
    listLineageFinishCounts(userId),
    listLineageLatestSessions(userId),
    listGoals(userId),
  ]);

  const goalById = new Map(goals.map((g) => [g.goal_id, g]));
  const finishByCommitment = new Map(finishRows.map((r) => [r.commitment_id, r]));
  const sessionByCommitment = new Map(sessionRows.map((r) => [r.commitment_id, r.session]));

  // Group over EVERY version of every lineage FIRST — a commitment's `kind` (and category) can
  // differ between plan versions ("Log breakfast" was `user` in v1, `system` in v2 in the dev
  // account that surfaced this), so filtering kind/category before grouping would judge a lineage
  // by whichever version's row happened to survive the filter, not by its CURRENT identity.
  const latest = latestVersionByCommitment(versions);

  const routines: Routine[] = [];
  for (const [commitmentId, row] of latest) {
    // The lineage's CURRENT state decides whether it's a routine at all: latest-row kind must be
    // 'user' (a system-kind commitment — a capture task like "Log breakfast" — is not a routine,
    // however it started life), and the same off-plan-bucket exclusion buildPlanView's
    // committed-rhythm list applies (plan-view.ts) is checked on the latest row too.
    if (row.kind !== 'user') continue;
    if (row.category && NON_PLAN_CATEGORIES.has(row.category)) continue;
    const rowArea = row.goal_id ? goalById.get(row.goal_id)?.area : undefined;
    if (area && rowArea !== area) continue;
    const onPlan = row.plan_status === 'active';
    const finish = finishByCommitment.get(commitmentId);
    routines.push({
      commitment_id: commitmentId,
      title: row.title,
      ...(rowArea ? { area: rowArea } : {}),
      ...(onPlan
        ? { cadence: describeRecurrence(row.schedule?.recurrence ?? ''), duration_min: row.schedule?.duration_min }
        : {}),
      steps: stepNames(sessionByCommitment.get(commitmentId)),
      finishes: finish?.finishes ?? 0,
      last_done: finish?.last_done ?? null,
      on_plan: onPlan,
    });
  }

  routines.sort((a, b) => {
    if (b.finishes !== a.finishes) return b.finishes - a.finishes;
    const ad = a.last_done ?? '';
    const bd = b.last_done ?? '';
    return bd < ad ? -1 : bd > ad ? 1 : 0;
  });
  return routines;
}
