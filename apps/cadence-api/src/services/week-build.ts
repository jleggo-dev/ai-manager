import { getActivePlan, setPlanBuiltThrough } from '../repos/plans.ts';
import { getUser } from '../repos/users.ts';
import { runInBackground } from './background.ts';
import { listActivities, NON_PLAN_CATEGORIES } from '../repos/activities.ts';
import { listOccurrences } from '../repos/occurrences.ts';
import { commitActivities, type CommitResult } from './plan-synthesis.ts';
import { toPendingPlanActivity } from './plan-partial-apply.ts';
import { computeWeekState } from './plan-view.ts';
import { sendPlanReadyPush } from './plan-ready-push.ts';
import { DEFAULT_HORIZON_DAYS, ensureHorizon } from './plan-horizon.ts';
import { clockLabel, parseTimeOfDay } from '@cadence/shared';

export interface WeekBuildResult {
  status: 'committed' | 'no_plan' | 'not_due';
  planId?: string;
  version?: number;
  activities?: number;
  occurrences?: number;
  note?: string;
}

/**
 * "Build next week" before the check-in (owner, 2026-09-09): the days past the check-in are locked
 * because the check-in can redefine them — but someone planning ahead may build them now, on the
 * same rhythm, and the check-in stays exactly where it was. Three rules, all the owner's:
 *
 *  - It does NOT move the check-in. The week clock and `horizon_days` are untouched; when the
 *    check-in day arrives it still asks. (An early CHECK-IN moves it — that is the review's job.)
 *  - It writes the following week — `ensureHorizon` through the check-in date plus one horizon —
 *    and records the decision as `built_through` (0059), which is what opens those days on the
 *    trail. Rows alone are not the decision: an ordinary mid-week commit also reaches past the
 *    check-in as a side effect, and those days stay locked.
 *  - It is the mid-week half only. A week that is over goes through `buildNextWeek` (the
 *    roll-forward that skips the check-in) — `due` tells the caller so.
 */
export interface WeekAheadResult {
  status: 'built' | 'already_built' | 'due' | 'no_plan';
  builtThrough?: string;
  occurrences?: number;
}

export async function buildWeekAhead(userId: string): Promise<WeekAheadResult> {
  const plan = await getActivePlan(userId);
  if (!plan) return { status: 'no_plan' };
  const state = computeWeekState(plan, (await getUser(userId))?.timezone)!;
  if (state.checkin_due) return { status: 'due' };

  const target = addDays(state.ends_on, DEFAULT_HORIZON_DAYS);
  if (state.built_through && state.built_through >= target) {
    return { status: 'already_built', builtThrough: state.built_through };
  }
  // ensureHorizon counts from TODAY; the target is a date. Convert, never overshooting: the days
  // between today and the target are exactly the ones a tap on a locked day was asking for.
  const fromToday = Math.ceil((Date.parse(`${target}T00:00:00Z`) - Date.now()) / 86_400_000);
  const occurrences = fromToday > 0 ? await ensureHorizon(userId, fromToday) : 0;
  await setPlanBuiltThrough(plan.plan_id, target);
  return { status: 'built', builtThrough: target, occurrences };
}

const FULL_WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Said when there is nothing timed worth naming — no user-kind occurrence at all, or one with no
 *  clock time. As calm as the copy it stands in for: this is still "your week is ready", not an
 *  error, so it never hints that something is missing. */
const READY_FALLBACK_BODY = "Come take a look when you're ready.";

/** date-only arithmetic, no zone involved — mirrors notify/producers/clock.ts's own `addDays`,
 *  kept local rather than imported so this file's only dependency on the notify module is the
 *  ready-push send itself. */
function addDays(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days)).toISOString().slice(0, 10);
}

/**
 * "First up: Tuesday, 7 — Easy run." — the one fact from the new week worth naming in the ready
 * push. `listOccurrences` already orders by date then time_of_day, so the first `kind === 'user'`
 * row IS the earliest thing the user will actually do; anything before it is a system activity
 * (the check-in itself, a weigh-in) that isn't the "first up" a person is picturing.
 *
 * Falls back to `READY_FALLBACK_BODY` when there is no user occurrence in the window at all, or
 * the one found has no clock time to name — a flexible/untimed activity is real, but "First up:
 * Tuesday — stretch." names a day with nothing on it yet, which reads as broken rather than open.
 */
async function composeReadyPushBody(userId: string, planId: string): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const first = (await listOccurrences(userId, today, addDays(today, 7))).find((o) => o.kind === 'user');
  if (!first) return READY_FALLBACK_BODY;

  const activity = (await listActivities(planId)).find((a) => a.activity_id === first.activity_id);
  const time = activity ? parseTimeOfDay(activity.schedule?.time_of_day) : null;
  if (!activity || !time) return READY_FALLBACK_BODY;

  const weekday = FULL_WEEKDAY[new Date(first.date).getUTCDay()];
  return `First up: ${weekday}, ${clockLabel(time.hour, time.minute)} — ${activity.title}.`;
}

/**
 * "Just build my week — I trust you" (DESIGN-check-in.md's skip path, and the copy rule that goes
 * with it: never "Skip", never "Not now" — this is trust, not dismissal). A COMMIT, not a
 * synthesis: no model call anywhere. The outgoing week's own activities are recommitted as the
 * next version UNCHANGED, which is exactly what makes this the safe low-friction default — nothing
 * about the plan itself changes, only the calendar rolls forward. `commitActivities` bumps
 * `plan.version`, re-materializes the next `DEFAULT_HORIZON_DAYS`, and fires its own
 * fire-and-forget session warm-up (plan-synthesis.ts) — all for free, the same as any other commit.
 *
 * Guard, both 409-shaped: no active plan to rebuild from, or the current week genuinely isn't over
 * yet (`checkin_due` false). "Just build my week" ends a week — it is never a way to skip ahead of
 * one that's still running.
 */
export async function buildNextWeek(userId: string): Promise<WeekBuildResult> {
  const plan = await getActivePlan(userId);
  if (!plan) return { status: 'no_plan' };

  // Due by the user's own day (plan-view.ts) — the day the trail's card said "check in".
  const state = computeWeekState(plan, (await getUser(userId))?.timezone);
  if (!state?.checkin_due) return { status: 'not_due' };

  // Off-plan/episode/menu buckets are derived per-version (getOrCreateAdhocActivity et al. lazily
  // recreate them against the NEW plan_id the moment they're next needed) — a normal replan never
  // carries them forward either, via the same filter buildPlanView already applies to its own list.
  const activities = (await listActivities(plan.plan_id)).filter(
    (a) => !a.category || !NON_PLAN_CATEGORIES.has(a.category),
  );

  const result: CommitResult = await commitActivities(userId, {
    activities: activities.map(toPendingPlanActivity),
    note: 'Kept your rhythm — building your next week.',
    goalIds: plan.goal_ids,
    // One of the two check-in exits (0058): this commit STARTS the next week, so the week clock
    // resets to now. An ordinary commit would carry the ended week's clock forward and the wall
    // on the trail would stay up.
    startsNewWeek: true,
    // The same rhythm, rolled forward — not a build (situation.ts measures its month from builds).
    generatedBy: 'roll_forward',
  });

  // "Week N is ready" — fire-and-forget, deliberately: unlike first-lock and replan (services/
  // lock.ts, replan.ts), nobody is watching a screen for this build to land, so there is no reason
  // to make the response wait on APNs. `sendPlanReadyPush` never throws past its own catch; the
  // `.catch` here is belt-and-braces against composeReadyPushBody's own DB reads, which are not
  // wrapped — a failure to compose "first up" must not touch the commit that already succeeded.
  if (result.planId) {
    const planId = result.planId;
    const version = result.version;
    runInBackground(
      'buildNextWeek ready-push (the build landed regardless)',
      composeReadyPushBody(userId, planId).then((body) =>
        sendPlanReadyPush(userId, 'checkin_replan_ready', planId, `Week ${version} is ready`, body),
      ),
    );
  }

  return {
    status: 'committed',
    planId: result.planId,
    version: result.version,
    activities: result.activities,
    occurrences: result.occurrences,
    note: result.note,
  };
}
