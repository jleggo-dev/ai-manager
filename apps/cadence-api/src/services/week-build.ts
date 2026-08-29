import { getActivePlan } from '../repos/plans.ts';
import { runInBackground } from './background.ts';
import { listActivities, NON_PLAN_CATEGORIES } from '../repos/activities.ts';
import { listOccurrences } from '../repos/occurrences.ts';
import { commitActivities, type CommitResult } from './plan-synthesis.ts';
import { toPendingPlanActivity } from './plan-partial-apply.ts';
import { computeWeekState } from './plan-view.ts';
import { sendPlanReadyPush } from './plan-ready-push.ts';
import { clockLabel, parseTimeOfDay } from '@cadence/shared';

export interface WeekBuildResult {
  status: 'committed' | 'no_plan' | 'not_due';
  planId?: string;
  version?: number;
  activities?: number;
  occurrences?: number;
  note?: string;
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

  const state = computeWeekState(plan);
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
