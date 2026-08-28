/**
 * The check-in's deterministic half (DESIGN-check-in.md: "one fat tool, not seven small ones").
 *
 * Given a window, return the whole week as a grid the review card can render and the user can
 * correct — no model call anywhere in this file. Same division of labour the old `recap.ts`
 * stated for itself: "code computes, the model narrates." DESIGN-check-in.md item 9 is done —
 * `recap.ts` (and `buildRecapFacts` with it) is retired: the narrate-only readout has no place
 * once the review write-back (check-in rebuild, step 5) lets the user correct it directly.
 *
 * The join is deliberately the same shape `buildPlanView` (plan-view.ts) already uses —
 * `listOccurrences` + `listActivities`, bucketed by day — because this is the same week the Week
 * tab shows, just re-cut for review instead of for the trail. `plan-view.ts` itself is left alone
 * (out of scope for this change); this file is its own join, not a shared one, so the two can evolve
 * independently.
 */
import type { Activity, GoalArea, OccurrenceLog, OccurrenceSession, OccurrenceStatus } from '@cadence/shared';
import { getActivePlan } from '../repos/plans.ts';
import { listActivities } from '../repos/activities.ts';
import {
  findWeighInOccurrence,
  listOccurrences,
  listOccurrenceSessionLogs,
  type OccurrenceListRow,
} from '../repos/occurrences.ts';
import { listGoals } from '../repos/goals.ts';

/** The three meal slots the review grid shows — deliberately NOT `snack` (DESIGN-check-in.md's
 *  receipt example, "18 of 21 meals", is 3 meals × 7 days; a logged snack still counts on Today,
 *  it just isn't one of this grid's confirmable slots). */
const MEALS = ['breakfast', 'lunch', 'dinner'] as const;
export type WeekReviewMeal = (typeof MEALS)[number];

/** A movement/practice session for the day — the tri-state the UI needs: pending (unconfirmed),
 *  done, skipped. `missed`/`paused` can still appear (they're real `OccurrenceStatus` values); the
 *  review treats anything not done/skipped as needing the user's word. */
export interface WeekReviewSessionRow {
  occurrence_id: string;
  title: string;
  status: OccurrenceStatus;
  /** The EFFORT the plan scheduled (activity `schedule.duration_min`) — absent for untimed rows. */
  planned_min?: number;
  /** What was actually logged (`occurrence.value.duration_min`), when present. */
  logged_min?: number;
}

export interface WeekReviewMealSlot {
  meal: WeekReviewMeal;
  /** Null when no per-meal row exists for that day (a plan that predates the per-meal split, or a
   *  day outside the materialized horizon) — the card has nothing to toggle. */
  occurrence_id: string | null;
  logged: boolean;
}

export interface WeekReviewMindStep {
  name: string;
  done: boolean;
}

/** A mind/practice occurrence. Exactly one of `steps`/`done` is set: `steps` when the cached
 *  session named its items (so the card can show step-level completion), `done` otherwise (a
 *  session was never prescribed, or was prescribed with no named items to check off). */
export interface WeekReviewMindRow {
  occurrence_id: string;
  title: string;
  status: OccurrenceStatus;
  steps?: WeekReviewMindStep[];
  done?: boolean;
}

export interface WeekReviewDay {
  date: string; // YYYY-MM-DD
  sessions: WeekReviewSessionRow[];
  /** Always exactly 3 entries, breakfast/lunch/dinner in that order — a fixed slot count is what
   *  makes `meals_total` in week-review-diff.ts arithmetic (7 × 3 = 21) hold without recounting. */
  meals: WeekReviewMealSlot[];
  mind: WeekReviewMindRow[];
}

/** The week's one-off task — not a per-day row (it's scheduled once, most likely on the plan's
 *  weigh-in day), so it rides on the facts payload beside `days` rather than inside one of them. */
export interface WeekReviewWeighIn {
  occurrence_id: string;
  date: string;
  status: string;
}

export interface WeekReviewFacts {
  period: { from: string; to: string };
  days: WeekReviewDay[];
  weigh_in: WeekReviewWeighIn | null;
}

/** Same defensive cast `plan-view.ts`'s `iso()` uses: `listOccurrences` declares `date: string`,
 *  but what the driver actually hands back for an un-formatted `date` column is a JS `Date`. */
const iso = (d: string | Date): string => new Date(d).toISOString().slice(0, 10);

function enumerateDates(from: string, to: string): string[] {
  const dates: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 86_400_000) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}

function emptyDay(date: string): WeekReviewDay {
  return {
    date,
    sessions: [],
    meals: MEALS.map((meal) => ({ meal, occurrence_id: null, logged: false })),
    mind: [],
  };
}

/** The meal a system row's title names, or undefined for a non-meal system row (check-in,
 *  weigh-in) — same substring match `findPendingMealOccurrence`/`findMealOccurrence` use in SQL. */
function matchMeal(title: string): WeekReviewMeal | undefined {
  return MEALS.find((meal) => new RegExp(meal, 'i').test(title));
}

/** Step-level completion for a mind/practice occurrence, from its cached session (if any) overlaid
 *  with its log (if any) — falls back to a plain `done` boolean when there's no named-item session
 *  to seed a checklist from. */
function buildMindRow(
  o: OccurrenceListRow,
  activity: Activity,
  detail: { session: OccurrenceSession | null; log: OccurrenceLog | null } | undefined,
): WeekReviewMindRow {
  const row: WeekReviewMindRow = { occurrence_id: o.occurrence_id, title: activity.title, status: o.status };
  const itemNames = detail?.session?.blocks.flatMap((b) => b.items.map((i) => i.name)) ?? [];
  if (itemNames.length > 0) {
    const doneByName = new Map((detail?.log?.items ?? []).map((i) => [i.name, i.done === true]));
    row.steps = itemNames.map((name) => ({ name, done: doneByName.get(name) ?? false }));
  } else {
    row.done = o.status === 'done';
  }
  return row;
}

const isMindArea = (area: GoalArea | undefined): boolean => area === 'mind' || area === 'practice';

/**
 * The week's facts, computed. No AI in this function, deliberately — same rule the old
 * `buildRecapFacts` stated for itself. `(from, to)` are whatever window the caller wants reviewed
 * (a plan week, "last week", a quarter); nothing here assumes seven days.
 *
 * Known limitation, inherited from `buildPlanView`'s own join rather than introduced here: activities
 * are read from the CURRENT active plan only, so an occurrence whose activity belonged to a plan
 * version superseded mid-window (rare — a replan mid-week) won't resolve a title and is dropped from
 * its day, exactly as it already is on the Week tab today.
 */
export async function buildWeekReviewFacts(userId: string, from: string, to: string): Promise<WeekReviewFacts> {
  const plan = await getActivePlan(userId);
  const [occurrences, sessionLogs, weighIn, goals] = await Promise.all([
    listOccurrences(userId, from, to),
    listOccurrenceSessionLogs(userId, from, to),
    findWeighInOccurrence(userId, from, to),
    listGoals(userId),
  ]);
  const activities = plan ? await listActivities(plan.plan_id) : [];

  const actById = new Map(activities.map((a) => [a.activity_id, a]));
  const areaByGoalId = new Map(goals.map((g) => [g.goal_id, g.area]));
  const detailByOccurrence = new Map(sessionLogs.map((r) => [r.occurrence_id, r]));

  const dayByDate = new Map(enumerateDates(from, to).map((date) => [date, emptyDay(date)]));

  for (const o of occurrences) {
    const activity = actById.get(o.activity_id);
    const day = dayByDate.get(iso(o.date));
    if (!activity || !day) continue;

    if (activity.kind === 'system') {
      const meal = matchMeal(activity.title);
      const slot = meal && day.meals.find((s) => s.meal === meal);
      if (slot) {
        slot.occurrence_id = o.occurrence_id;
        slot.logged = o.status === 'done';
      }
      continue; // weigh-in / check-in system rows: handled by their own dedicated lookups, not here
    }

    const area = activity.goal_id ? areaByGoalId.get(activity.goal_id) : undefined;
    if (isMindArea(area)) {
      day.mind.push(buildMindRow(o, activity, detailByOccurrence.get(o.occurrence_id)));
    } else {
      day.sessions.push({
        occurrence_id: o.occurrence_id,
        title: activity.title,
        status: o.status,
        planned_min: activity.schedule.duration_min,
        logged_min: o.value?.duration_min,
      });
    }
  }

  return {
    period: { from, to },
    days: [...dayByDate.values()],
    weigh_in: weighIn ? { occurrence_id: weighIn.occurrence_id, date: weighIn.date, status: weighIn.status } : null,
  };
}
