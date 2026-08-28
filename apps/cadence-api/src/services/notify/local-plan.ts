import type { IosWeekday, NudgeWaypoint, SchedulableActivity } from '@cadence/shared';
import { getActivePlan } from '../../repos/plans.ts';
import { listActivities } from '../../repos/activities.ts';
import { listOccurrences } from '../../repos/occurrences.ts';
import { getActiveEpisode } from '../../repos/episodes.ts';
import { listGoalsByStatus } from '../../repos/goals.ts';
import { getUser } from '../../repos/users.ts';
import { localMinutes } from './policy.ts';
import { addDays, daysBetween, userToday } from './producers/clock.ts';
import { waypointsForGoals } from './waypoints.ts';

/**
 * Everything the DEVICE needs in order to schedule the four local nudges itself.
 *
 * Assembled here rather than in the web client for one reason: the suppression rules are the
 * important part, and they need data the plan view does not carry. "Was yesterday already
 * explained by a freeze or a detour?" and "is this user on a detour, so waypoints are silence?"
 * are questions about the streak state, the episode table and the goal set. A client
 * reconstructing them from a week view would get them approximately right, and approximately right
 * is a notification about a day the coach already accounted for.
 *
 * The device still owns the SCHEDULING (quiet-hours clamping, tier gating, the iOS ceiling) via
 * `buildLocalNudges`, because those need the user's own clock and the OS's own limits.
 */

export interface LocalNudgePlan {
  today: string;
  todayWeekday: IosWeekday;
  nowMinutes: number;
  activities: SchedulableActivity[];
  flexibleToday: SchedulableActivity | null;
  yesterday: { done: number; planned: number } | null;
  waypoints: NudgeWaypoint[];
}

/** An empty plan is a valid answer: it CANCELS everything on the device, which is right when a
 *  plan is cleared or the user starts over. */
const EMPTY: LocalNudgePlan = {
  today: '',
  todayWeekday: 1,
  nowMinutes: 0,
  activities: [],
  flexibleToday: null,
  yesterday: null,
  waypoints: [],
};

/** iOS weekday numbering from a YYYY-MM-DD: 1 = Sunday … 7 = Saturday. */
function iosWeekday(dateIso: string): IosWeekday {
  const [y, m, d] = dateIso.split('-').map(Number);
  const day = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
  return (day + 1) as IosWeekday;
}

function toSchedulable(a: Awaited<ReturnType<typeof listActivities>>[number]): SchedulableActivity {
  return {
    activity_id: a.activity_id,
    title: a.title,
    schedule: { recurrence: a.schedule?.recurrence ?? '', time_of_day: a.schedule?.time_of_day },
    category: a.category ?? null,
  };
}

/**
 * Yesterday's honest count — or null, which means "say nothing about yesterday".
 *
 * Null in three cases, and each is a rule rather than a fallback:
 *   • a detour covers the day        — the coach already agreed the plan was shelved
 *   • a freeze absorbed it           — freeze_save is already telling them, and two notifications
 *                                      about the same day is one too many
 *   • nothing was planned, or it was all kept — there is nothing to lighten
 */
function yesterdayCount(
  occurrences: Awaited<ReturnType<typeof listOccurrences>>,
  yesterdayIso: string,
): { done: number; planned: number } | null {
  let done = 0;
  let planned = 0;
  for (const o of occurrences) {
    if (new Date(o.date).toISOString().slice(0, 10) !== yesterdayIso) continue;
    // `skipped` is an acknowledged pass and `paused` was shelved: neither is an obligation, so
    // neither belongs in the denominator. Counting them would manufacture a shortfall.
    if (o.status === 'done') {
      done += 1;
      planned += 1;
    } else if (o.status === 'pending' || o.status === 'missed') {
      planned += 1;
    }
  }
  return planned > 0 && done < planned ? { done, planned } : null;
}

/** Today's first still-open untimed activity — the one before_quiet_hours is about. */
function findFlexibleToday(
  occurrences: Awaited<ReturnType<typeof listOccurrences>>,
  activities: SchedulableActivity[],
  todayIso: string,
): SchedulableActivity | null {
  const byId = new Map(activities.map((a) => [a.activity_id, a]));
  for (const o of occurrences) {
    if (new Date(o.date).toISOString().slice(0, 10) !== todayIso || o.status !== 'pending') continue;
    const activity = byId.get(o.activity_id);
    // Untimed is the whole definition of flexible here: something with a set time already has its
    // own almost_time nudge, and telling someone it "still fits" after its hour has gone is odd.
    if (activity && !activity.schedule.time_of_day) return activity;
  }
  return null;
}

/**
 * Build the device's input. Never throws — the caller is a route the app hits on every plan load,
 * and a notification problem must not stop the plan rendering.
 */
export async function buildLocalNudgePlan(userId: string, now: Date = new Date()): Promise<LocalNudgePlan> {
  const user = await getUser(userId);
  const today = userToday(now, user?.timezone);
  const mins = localMinutes(now, user?.timezone);
  const plan = await getActivePlan(userId);
  if (!today || mins == null || !plan) return EMPTY;

  const yesterdayIso = addDays(today, -1);
  const [rows, occurrences, episode, goals] = await Promise.all([
    listActivities(plan.plan_id),
    listOccurrences(userId, yesterdayIso, today),
    getActiveEpisode(userId),
    listGoalsByStatus(userId, ['committed', 'confirmed']),
  ]);

  const activities = rows.filter((a) => a.kind === 'user').map(toSchedulable);
  const freezeCoveredYesterday = user?.streak_state?.last_saved_by_freeze === yesterdayIso;
  const onDetour = Boolean(episode) && daysBetween(today, episode?.end ?? today) >= 0;

  return {
    today,
    todayWeekday: iosWeekday(today),
    nowMinutes: mins,
    activities,
    flexibleToday: findFlexibleToday(occurrences, activities, today),
    yesterday: onDetour || freezeCoveredYesterday ? null : yesterdayCount(occurrences, yesterdayIso),
    // A countdown to a day you have already told us you cannot train for is pressure, not
    // anticipation — so a detour silences every waypoint for its duration.
    waypoints: onDetour ? [] : waypointsForGoals(goals, today),
  };
}
