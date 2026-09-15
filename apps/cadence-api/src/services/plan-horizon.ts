import { getActivePlan, setPlanHorizon } from '../repos/plans.ts';
import { listActivities } from '../repos/activities.ts';
import { getUser } from '../repos/users.ts';
import { upsertOccurrences, type NewOccurrence } from '../repos/occurrences.ts';
import { listSettledCommitmentDates } from '../repos/commitment-dates.ts';
import { expandRecurrence } from './scheduling.ts';
import { localMinutes } from './notify/policy.ts';
import { localDayIso, localDayIsoPlus } from './plan-day.ts';
import { weekStartMs } from './week-clock.ts';

/**
 * The horizon IS the view window (check-in rebuild, step 6) — 7, not 14. A plan used to
 * materialize two weeks ahead of whatever the user could actually see, so the trail never had an
 * edge and the coach never got a natural moment to ask "how was the week?" Owner: "Just infinitely
 * generating a plan doesn't really ensure success and success is what we're after." The week the
 * user sees IS the week, and its last day is the deliberate check-in moment (docs/cadence/
 * DESIGN-check-in.md, plan-view.ts's `computeWeekState`) — timed by the week clock (0058), not
 * by the rows running out, which is what lets `writtenAheadDays` below keep the following week
 * written without moving the check-in an inch.
 */
export const DEFAULT_HORIZON_DAYS = 7;

/**
 * How far the calendar is always written, counted from today: the view and the week after it
 * (owner, 2026-09-14: "we should always have the 2nd week loaded, so there's always something to
 * show"). The days past the check-in stay LOCKED on the trail (trailLock.ts keys off `ends_on`,
 * never off rows), and the check-in still redraws them — a commit wipes the outgoing plan's
 * future pending rows and writes its own. What this closes is the hole between "the week wrote
 * 7 days at its commit" and "the check-in is day 7": the check-in day itself had nothing on it,
 * and "Confirm my week" with nothing to change reset the clock without writing a single day.
 */
export function writtenAheadDays(viewDays: number): number {
  return viewDays + DEFAULT_HORIZON_DAYS;
}

/**
 * Has the written calendar fallen short of `reachTo`? True when no row of the ACTIVE plan lands
 * in the final `DEFAULT_HORIZON_DAYS` before it. A plan with any weekly-or-denser commitment
 * lands one there once written, so this is quiet on every ordinary load and fires only on the
 * day the window moves past what was written. A plan whose rhythm could never write a row (no
 * recurrences at all) is never short — asking would just be asking again on the next load.
 * `rows` may be any user occurrence in range; only the active plan's activities count, since
 * a superseded version's leftover rows are not the calendar the user has.
 */
export function horizonFallsShort(
  rows: Array<{ activity_id: string; date: string | Date }>,
  activities: Array<{ activity_id: string; schedule?: { recurrence?: string | null } | null }>,
  reachTo: string,
): boolean {
  if (!activities.some((a) => a.schedule?.recurrence)) return false;
  const active = new Set(activities.map((a) => a.activity_id));
  const tailFrom = new Date(Date.parse(`${reachTo}T00:00:00Z`) - (DEFAULT_HORIZON_DAYS - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return !rows.some((r) => active.has(r.activity_id) && new Date(r.date).toISOString().slice(0, 10) >= tailFrom);
}

/** The most a week may be stretched to (0050) — past this it's a different plan, not a longer
 *  week, and the conversation should go through a re-plan instead. */
export const MAX_HORIZON_DAYS = 28;

/** "06:30" → 390. Anything that isn't a clock time (a word like "morning", or nothing at all)
 *  returns null and is never treated as past — we only skip what we can actually place. */
export function minutesOfDay(timeOfDay: string | undefined | null): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((timeOfDay ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Horizon materialization: ensure dated occurrences exist for the user's active plan from today
 * through today+`days`. Idempotent — `upsertOccurrences` is `on conflict (activity_id, date) do
 * nothing` — so a repeat call just tops up newly-in-range days without disturbing what's there.
 *
 * **Three callers, each with a reason (2026-09-14).** `commitActivities` (plan-synthesis.ts)
 * writes a week at the commit that creates it; `buildPlanView` keeps the calendar written through
 * `writtenAheadDays` — guarded by `horizonFallsShort`, so it runs on the day the window moves
 * past what was written and not on every load; and "Confirm my week" (routes/week-review.ts)
 * writes the week it just started, because a confirm may commit nothing and used to leave the
 * new week with no days at all. None of them moves the check-in: that is the week clock's
 * (0058), and the step-6 worry — a view that kept writing days meant a week that never ended —
 * no longer applies. Recurrences are anchored to the plan's `generated_at`, so INTERVAL patterns
 * (every other day / week) keep the same parity across calls. Returns the count materialized.
 *
 * **Never invents a task in the past.** A slot for TODAY whose time has already gone by is
 * skipped, and the reason shows up hardest on the day a plan is born: someone who finished
 * onboarding at 9am was handed a 6:30 meditation and a 6:30 long run they could not possibly
 * have done, which the app would then count as missed. Their first morning with a coach opened
 * with two failures it had invented itself.
 *
 * It only ever affects slots being created LATE — a day already materialized keeps everything it
 * had, because the upsert leaves existing rows alone. So "today's 6:30 run" still stands all day
 * for anyone whose horizon reached today before 6:30, which is everyone with a plan older than a
 * day. Skipped only when we would be writing it down after the moment has passed.
 *
 * An unknown timezone means we cannot say what time it is for them, so nothing is skipped: a task
 * they can still do is a much smaller harm than a task quietly missing from their day.
 */
export async function ensureHorizon(
  userId: string,
  days = DEFAULT_HORIZON_DAYS,
  opts: { keepElapsedToday?: boolean } = {},
): Promise<number> {
  const plan = await getActivePlan(userId);
  if (!plan) return 0;

  const anchor = new Date(plan.generated_at).toISOString().slice(0, 10);
  // THEIR today, not the server's: from 20:00 in Montreal the UTC date is already tomorrow, and
  // a fill that starts there leaves the evening the person is still living in with nothing
  // (plan-day.ts, `localDayIso`). No stored zone → UTC, the same floor the view uses.
  const now = new Date();
  const timezone = (await getUser(userId))?.timezone;
  const today = localDayIso(now, timezone);
  const to = localDayIsoPlus(now, days, timezone);

  const activities = await listActivities(plan.plan_id);
  const nowMinutes = localMinutes(now, timezone);
  /**
   * A commitment already settled on a date is never re-issued for it.
   *
   * Every commit inserts fresh activity rows, and the upsert's duplicate check is keyed on the
   * row, not the commitment. The commit carries an unchanged activity's PENDING rows onto its new
   * row, but a row already done is history and stays behind on the old version — so the fill
   * saw the new ruck activity with nothing on today and issued a second ruck two hours after the
   * first was finished and logged (2026-09-06, over a weigh-in moved to Monday). The commitment
   * lineage is the fact that says they are the same thing; this is where it gets consulted.
   * A second session added on purpose carries its own commitment id and is unaffected.
   */
  const settled = new Set(
    (await listSettledCommitmentDates(userId, today, to)).map((r) => `${r.commitment_id}|${r.date}`),
  );
  const occ: NewOccurrence[] = [];
  for (const a of activities) {
    const recurrence = a.schedule?.recurrence;
    if (!recurrence) continue;
    const startsAt = minutesOfDay(a.schedule?.time_of_day);
    for (const date of expandRecurrence(recurrence, today, to, anchor)) {
      if (a.commitment_id && settled.has(`${a.commitment_id}|${date}`)) continue;
      /**
       * Skipping a slot whose hour has already gone is right for the ROLLING TOP-UP — nobody wants
       * a 6am session materialized at 3pm. It is exactly wrong after a COMMIT, and it silently ate
       * a day of the owner's plan (2026-08-16): he applied a change to today's grip finisher in the
       * afternoon, the commit deleted today's pending rows and re-materialized from here, and every
       * commitment scheduled EARLIER than that moment — the session he had just edited, and his
       * breakfast log — was deleted and refused re-creation. Only the evening items came back.
       *
       * A plan change must never delete the day you are standing in. `keepElapsedToday` is set by
       * the commit path and nowhere else.
       */
      const elapsedToday = date === today && nowMinutes != null && startsAt != null && startsAt < nowMinutes;
      if (elapsedToday && !opts.keepElapsedToday) continue;
      occ.push({ activity_id: a.activity_id, user_id: userId, date });
    }
  }
  await upsertOccurrences(occ);
  return occ.length;
}

export type ExtendHorizonResult =
  | { status: 'no_plan' }
  /** Already at (or past) the asked-for length — nothing moved. `endsOn` is the standing end. */
  | { status: 'unchanged'; horizonDays: number; endsOn: string }
  | { status: 'extended'; horizonDays: number; endsOn: string; materialized: number };

/**
 * Stretch the ACTIVE plan's week to `days` counted from the day it began (0050) — the user's
 * "can we plan two weeks ahead?" ask, granted by the coach. Two effects, both from facts the
 * plan already owns: `horizon_days` moves (so `computeWeekState`'s `ends_on`/`checkin_due` and
 * the weekly_checkin push move with it), and `ensureHorizon` tops up the newly-in-range days
 * with the SAME rhythm — no redesign, the existing recurrences simply keep walking.
 *
 * Extends only — asking for fewer days than the week already runs is reported back as
 * `unchanged`, never applied: shortening a week is the check-in conversation's job, not a
 * side effect of a mis-phrased extend. The cap is `MAX_HORIZON_DAYS`.
 */
export async function extendHorizon(userId: string, days: number): Promise<ExtendHorizonResult> {
  const plan = await getActivePlan(userId);
  if (!plan) return { status: 'no_plan' };

  const asked = Math.min(Math.max(Math.trunc(days), 1), MAX_HORIZON_DAYS);
  const current = plan.horizon_days ?? DEFAULT_HORIZON_DAYS;
  // The week clock (0058) — the same start `computeWeekState` counts from, so the end this
  // reports back is the day the card and the push will actually name.
  const startMs = weekStartMs(plan);
  const endsOn = (h: number) => new Date(startMs + h * 86_400_000).toISOString().slice(0, 10);
  if (asked <= current) return { status: 'unchanged', horizonDays: current, endsOn: endsOn(current) };

  await setPlanHorizon(plan.plan_id, asked);
  // ensureHorizon counts from TODAY; the grant is anchored to the week's start. Convert so the
  // materialized span ends at week start + asked, mid-week or not — never today + asked, which
  // would quietly overshoot the very edge the check-in is timed to.
  const fromToday = Math.ceil((startMs + asked * 86_400_000 - Date.now()) / 86_400_000);
  const materialized = fromToday > 0 ? await ensureHorizon(userId, fromToday) : 0;
  return { status: 'extended', horizonDays: asked, endsOn: endsOn(asked), materialized };
}
