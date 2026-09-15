import type { Activity, OccurrenceStatus, PendingProposal, Plan, StreakView } from '@cadence/shared';
import { getActivePlan } from '../repos/plans.ts';
import { listActivities, listActivitiesByIds, NON_PLAN_CATEGORIES } from '../repos/activities.ts';
import { listOccurrences, listSessionStepCounts, type OccurrenceListRow } from '../repos/occurrences.ts';
import { getActiveEpisode } from '../repos/episodes.ts';
import { getUser } from '../repos/users.ts';
import { getLatestConversation } from '../repos/conversations.ts';
import { listGoals } from '../repos/goals.ts';
import { DEFAULT_HORIZON_DAYS, ensureHorizon, horizonFallsShort, writtenAheadDays } from './plan-horizon.ts';
import { describeRecurrence } from './scheduling.ts';
import { rollingConsistency } from './metrics.ts';
import { evaluateStreak } from './streak.ts';
import { localDayIso, planDayBase } from './plan-day.ts';
import { addDaysIso } from './progress-rhythm.ts';
import { builtThroughIso, weekStartIso, type WeekClockPlan } from './week-clock.ts';
import { previewFromDate, projectPreview, type PlanViewPreviewItem } from './plan-preview.ts';

export const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface PlanViewOccurrence {
  occurrence_id: string;
  activity_id: string;
  title: string;
  kind: 'user' | 'system';
  status: OccurrenceStatus;
  time_of_day?: string;
  steps?: number; // prescribed-item count from a cached session (drives the trail's step ring)
  /** Is this row's session already written? Present on user-kind rows only. `false` is the trail's
   *  honest hint that a tap starts the ~30-60s write (Gap 4, PLAN-CHANGES.md — the wire used to
   *  carry only `steps`, so a cold session rendered as an ordinary disc and the wait was
   *  discovered by tapping). Derived from the step-count read already in hand — that query only
   *  returns rows whose `session` is non-null — so this costs no new query. */
  session_ready?: boolean;
  /** The linked goal's area — the trail's icon family speaks the goal's own language rather than
   *  guessing from the title (piano wore the exercise glyph for want of this, 2026-08-31). */
  area?: 'movement' | 'nourishment' | 'mind' | 'practice';
}
export interface PlanViewDay {
  date: string; // YYYY-MM-DD
  weekday: string; // 'Mon'
  dayNum: number; // 6
  isToday: boolean;
  occurrences: PlanViewOccurrence[];
  /**
   * The rhythm drawn on a day BEHIND THE WALL (plan-preview.ts): what this day would hold, from the
   * plan's own recurrences, before the check-in that writes it down. Present only on days past the
   * week's end with no rows of their own; never on an open day. Nothing here has an id — it is a
   * picture of the plan, not the plan.
   */
  preview?: PlanViewPreviewItem[];
}
export interface PlanViewActivity {
  activity_id: string;
  /** The commitment this row is one version of (0036) — the thread a proposed week's rows carry
   *  too, so the client can say which of them is a CHANGE to this row and which is new. */
  commitment_id?: string;
  title: string;
  kind: 'user' | 'system';
  cadence: string; // humanized, e.g. "Every other day"
  recurrence: string;
  time_of_day?: string;
  /** Minutes of the EFFORT, not the whole session (owner ruling 2026-08-17) — a 40-minute run is
   *  40 here. The client pairs it with `sessionBudget(duration_min, area)` to show the time to set
   *  aside; nothing on this side sums or pads it. */
  duration_min?: number;
  /** The coach's rationale for THIS commitment, 1-3 sentences (0031) — the card renders it. */
  why?: string;
  /** Objective link, for grouping the card "Toward <goal>" (absent → Foundations). */
  goal_id?: string;
  goal_title?: string;
  /** The linked goal's area — colours the card's dots. Absent for system/foundational rows. */
  area?: 'movement' | 'nourishment' | 'mind' | 'practice';
  /** TRUE when the coach proposed this herself (adjacent support) — badged at the consent
   *  moment (the pre-signup card) only, never a permanent asterisk on Week/Today. */
  suggested?: boolean;
}
export interface PlanView {
  hasPlan: boolean;
  // Lets the frontend tell a genuinely new user (show Welcome) apart from one who's mid-onboarding
  // (skip straight to the coach chat, which restores their session) — `hasPlan` alone can't.
  stage: 'new' | 'in_progress' | 'committed';
  version?: number;
  committedAt?: string;
  /** The coach's whole-shape reasoning (0031). Absent on plans committed before it existed. */
  rationale?: string;
  activities: PlanViewActivity[];
  week: PlanViewDay[];
  consistency: { kept: number; window: number }; // "showed up N of 7 days" — the honest metric
  streak: StreakView; // the PROTECTED momentum counter that sits BESIDE consistency (Req 4)
  activeEpisode: ActiveEpisodeView | null; // set when the user is in a disrupted detour (Req 4)
  pendingProposal: PendingProposal | null; // a coach-proposed re-plan awaiting accept/dismiss
  /** Named `weekState`, not `week` — `week: PlanViewDay[]` above already owns that name. Null
   *  before a plan exists; see `computeWeekState`. */
  weekState: WeekState | null;
}

/** The slim "you're on a detour" shape the Today/Week view needs — the full episode isn't sent. */
export interface ActiveEpisodeView {
  type: 'travel' | 'illness' | 'injury' | 'recovery' | 'custom';
  start: string;
  end: string;
  /** Has the equipment question been ANSWERED — by words, photo, or at entry? Distinct from the
   *  list being empty: "no gym here" is an answer, silence is not. Drives the arrival card. */
  gearKnown: boolean;
  /**
   * A PAUSE: the stretch was cleared on purpose and nothing was overlaid (`pause_week`). A detour
   * asks what gear you have so it can shape the days; a pause has no days to shape, so the same
   * screens would ask a question with no answer. The flag is what lets the copy differ.
   */
  paused: boolean;
}

/** Neutral view when the streak evaluation itself fails — never let it break the plan load. */
const EMPTY_STREAK: StreakView = { current: 0, longest: 0, freezes: 0, savedByFreeze: false };

export const iso = (d: string | Date): string => new Date(d).toISOString().slice(0, 10);

/**
 * "Your week ends → you say so → she pulls the review" (DESIGN-check-in.md). `checkin_due` is the
 * ONE fact that loop needs, read fresh on every load; the push producer (checkin-due.ts) and the
 * coach's date line read the same fact the same way. The active plan `getActivePlan` returns is
 * by construction the newest version (every commit supersedes the one before it), so "no newer
 * version exists" needs no extra query.
 *
 * The clock is `week_started_at` (0058, week-clock.ts), NOT `generated_at`. "Any commit IS the
 * week being handled" was the original rule, and it meant a user who accepted a proposal, added a
 * routine or applied an Adjust mid-week silently restarted their week each time — the owner had
 * never once reached this flag (2026-09-07). Now an ordinary commit carries the clock forward and
 * only the two check-in exits reset it.
 *
 * `ends_on` is the DUE date: the week clock's local day plus the horizon. It is a DAY, and the
 * week is due from the start of that day in the user's zone (2026-09-14). It used to be due at
 * the exact instant — clock + 7×24h — while everything the user can see is a date: the trail
 * puts the check-in node and the "wraps up today" card on `ends_on` the moment that day dawns,
 * so a week that began at 14:53 spent the check-in's whole morning with the screen saying "today"
 * and the server (this flag, `build_next_week`'s guard, the coach's date line) saying "still
 * running". One day, one answer. `now` is injectable for tests; production always passes nothing.
 */
export interface WeekState {
  ends_on: string;
  checkin_due: boolean;
  /** The day the week began (YYYY-MM-DD) — the trail's gate prompt counts "day N of your plan"
   *  from it (owner, 2026-09-09). */
  started_on: string;
  /** How far ahead the user deliberately built (0059), or null — the trail locks every day past
   *  the later of `ends_on` and this. */
  built_through: string | null;
}
export function computeWeekState(
  plan: (WeekClockPlan & Pick<Plan, 'horizon_days'> & Partial<Pick<Plan, 'built_through'>>) | null,
  /** The user's zone (stored, else the client's hint). Absent → UTC, the horizon machinery's floor. */
  timezone?: string | null,
  now: Date = new Date(),
): WeekState | null {
  if (!plan) return null;
  // The week clock (0058, week-clock.ts): `week_started_at ?? generated_at`. The clock is what an
  // ordinary commit carries forward — "any commit IS the week being handled" turned out to mean
  // an engaged user never reached this line's `true` (owner, 2026-09-07).
  const started_on = weekStartIso(plan, timezone);
  // The plan's OWN horizon (0050) — 7 unless the user asked the coach to extend this week.
  const ends_on = addDaysIso(started_on, plan.horizon_days ?? DEFAULT_HORIZON_DAYS);
  return {
    ends_on,
    // Due from the first moment of `ends_on` in their zone — the same day the trail already
    // treats as the check-in's (trailLock.ts, checkinGate.ts compare local dates).
    checkin_due: localDayIso(now, timezone) >= ends_on,
    started_on,
    built_through: builtThroughIso(plan),
  };
}

/**
 * The calendar, written through `reachTo` (see `buildPlanView`). Quiet on every ordinary load —
 * a written plan lands a row in the far week — and only on the day the window moves past what
 * was written does it cost the top-up plus one re-read. Best effort: a top-up that fails hands
 * back whatever was written, never a failed screen.
 */
async function writtenThrough(
  userId: string,
  occ: OccurrenceListRow[],
  activities: Activity[],
  span: { from: string; reachTo: string; aheadDays: number },
): Promise<OccurrenceListRow[]> {
  if (!horizonFallsShort(occ, activities, span.reachTo)) return occ;
  const written = await ensureHorizon(userId, span.aheadDays).catch((e) => {
    console.error('[buildPlanView:horizon]', e);
    return 0;
  });
  return written > 0 ? listOccurrences(userId, span.from, span.reachTo) : occ;
}

/**
 * Assemble the ongoing "Today / Your week" view from the active plan: groups this week's
 * occurrences by day and reports rolling-window consistency (days you showed up, never a streak
 * that resets).
 *
 * **Keeps the calendar written past the view (owner, 2026-09-14) — and that is NOT the old
 * ever-extending horizon.** Check-in rebuild step 6 stopped this view topping up the horizon,
 * because back then the check-in was timed off the rows running out: a view that kept writing
 * days meant a week that never ended. The week clock (0058) ended that dependency — the check-in
 * lands on `ends_on` whatever is written, and the trail locks every day past it (trailLock.ts)
 * whether or not a row exists there. What the no-top-up rule left behind was a hole: a week
 * materializes 7 days at its commit, the check-in day itself is day 7, and "Confirm my week"
 * resets the clock without committing — so the owner confirmed a week at 07:26 on 2026-09-14 and
 * opened a plan with nothing on today, nothing on tomorrow, and a coach reading the same empty
 * calendar. Now the visible week AND the week after it are always written (`writtenAheadDays`);
 * the days past the check-in stay locked, and the check-in still redraws them.
 */
export async function buildPlanView(
  userId: string,
  /** How many days to render. Omit (undefined) for the plan's own horizon — 7 unless the user
   *  asked the coach to extend the week (0050). The watch passes its own small cap explicitly. */
  weekDays?: number,
  /** The caller's own zone, used only when the user has none stored — 94 of 96 rows today. */
  tzHint?: string | null,
): Promise<PlanView> {
  /**
   * Four independent reads, in one hop (PERF-05).
   *
   * These reads are independent of each other and were awaited one after another, which on a
   * cross-country hop is four full round trips for no reason: measured 2026-08-20, a bare query
   * costs ~181ms through the pooler, and GET /plan spent 2.0-3.8s running ~11 of them in series.
   * The dependency graph is much shallower than the old sequence implied — only `activities`
   * genuinely needs `plan`, and only the day window needs `user` (for the timezone).
   *
   * Each keeps its OWN catch, deliberately: `Promise.all` rejects on the first failure, so a
   * shared one would turn a missing episode into a failed screen. The per-call fallbacks below
   * are the same ones these calls always had.
   */
  const [streak, episode, plan, goalsList] = await Promise.all([
    evaluateStreak(userId).catch((e) => {
      console.error('[buildPlanView:streak]', e);
      return EMPTY_STREAK;
    }),
    getActiveEpisode(userId).catch(() => null),
    getActivePlan(userId),
    listGoals(userId).catch((e) => {
      console.error('[buildPlanView:goals]', e);
      return [];
    }),
  ]);
  const activeEpisode: ActiveEpisodeView | null = episode
    ? {
        type: episode.type,
        start: episode.start,
        end: episode.end,
        gearKnown:
          (episode.available_equipment ?? []).length > 0 ||
          (episode.constraints as { gear_confirmed?: unknown } | null)?.gear_confirmed === true,
        paused: (episode.constraints as { paused?: unknown } | null)?.paused === true,
      }
    : null;
  if (!plan) {
    // Started but hasn't locked yet (an open conversation, or goals captured some other way)
    // vs. never touched the app — the ONLY signal that distinguishes "bounce to Welcome" from
    // "resume the coach chat" for a user with no committed plan.
    // `goalsList` is already in hand from the batch above — only the conversation is still needed.
    const conversation = await getLatestConversation(userId).catch(() => null);
    const stage = conversation || goalsList.length > 0 ? 'in_progress' : 'new';
    return {
      hasPlan: false,
      stage,
      activities: [],
      week: [],
      consistency: { kept: 0, window: weekDays ?? DEFAULT_HORIZON_DAYS },
      streak,
      activeEpisode,
      pendingProposal: null,
      weekState: null,
    };
  }

  const activities = await listActivities(plan.plan_id);
  const actById = new Map(activities.map((a) => [a.activity_id, a]));

  /**
   * Which day is "today" — in the USER's zone, not the server's.
   *
   * This was `Date.UTC(now.getUTC*)`, so the whole screen rolled over at UTC midnight. In Montreal
   * (UTC-4) that is 20:00 local: on 2026-08-18 the owner's demo showed TODAY · WED 19 AUG at
   * 20:41 on a Tuesday. The label was the visible half; the costly half is right here — `base`
   * also sets the from/to that fetch occurrences, so after 8pm every evening the trail quietly
   * showed TOMORROW'S plan and called it today. Anything logged against "today" from that screen
   * landed on the wrong date.
   *
   * The zone is the stored one, else what the client told us this request (`tzHint`), else UTC.
   * UTC last and only as a floor: it is right for nobody in particular, but it is deterministic
   * and it is what the rest of the horizon machinery already assumes.
   */
  const user = await getUser(userId);
  const timezone = user?.timezone ?? null;
  const now = new Date();
  const base = planDayBase(now, timezone, tzHint);
  const days: PlanViewDay[] = [];
  // The view spans the plan's own horizon unless the caller (the watch) capped it — so an
  // extended week actually SHOWS its second week instead of rendering 7 days of a 14-day plan.
  const viewDays = weekDays ?? plan.horizon_days ?? DEFAULT_HORIZON_DAYS;
  for (let i = 0; i < viewDays; i++) {
    const d = new Date(base + i * 86_400_000);
    days.push({
      date: iso(d),
      weekday: WEEKDAY[d.getUTCDay()]!,
      dayNum: d.getUTCDate(),
      isToday: i === 0,
      occurrences: [],
    });
  }
  const dayByDate = new Map(days.map((dd) => [dd.date, dd]));

  const from = days[0]!.date;
  const to = days[days.length - 1]!.date;
  // How far the calendar must be written: the view plus the week after it (plan-horizon.ts). The
  // occurrence read reaches that far so ONE query answers both "what is on screen" (the day loop
  // below ignores dates past `to`) and "has the written week fallen short" (`horizonFallsShort`).
  const aheadDays = writtenAheadDays(viewDays);
  const reachTo = iso(new Date(base + aheadDays * 86_400_000));
  /**
   * The week, its step counts, and the trailing week for consistency — one round trip, not three
   * (PERF-05). All three depend only on the day window just computed, and on nothing from each
   * other; awaiting them in series was three cross-country hops to build one screen.
   */
  const pastFrom = iso(new Date(base - 6 * 86_400_000));
  const pastTo = iso(new Date(base));
  const [occRead, stepRows, past] = await Promise.all([
    listOccurrences(userId, from, reachTo),
    listSessionStepCounts(userId, from, to),
    listOccurrences(userId, pastFrom, pastTo),
  ]);
  const occ = await writtenThrough(userId, occRead, activities, { from, reachTo, aheadDays });
  const stepCounts = new Map(stepRows.map((r) => [r.occurrence_id, r.steps]));
  // Hoisted above the occurrence loop (2026-08-31): occurrences carry their goal's area now, so
  // the trail's icon family comes from the goal itself instead of a title guess.
  const goalById = new Map(goalsList.map((g) => [g.goal_id, g]));
  /**
   * Today's rows that belong to a SUPERSEDED plan version still render — under the title they
   * had. A commit re-points what it keeps and wipes what it changes from today forward, so
   * normally nothing of today is left behind; but a commit that read "today" as the UTC date
   * (fixed 2026-09-01, plan-day.ts) left the whole evening on the old plan, and every row
   * without a title to render under vanished from the screen with it. History is what was on the
   * card when it happened, so today's orphans are looked up by id across every plan version.
   * Future days stay the active plan's alone — an old version's tomorrow is not a plan anyone
   * still has.
   */
  const todayIso = days[0]!.date;
  const orphanIds = [
    ...new Set(occ.filter((o) => !actById.has(o.activity_id) && iso(o.date) <= todayIso).map((o) => o.activity_id)),
  ];
  if (orphanIds.length > 0) {
    for (const a of await listActivitiesByIds(userId, orphanIds).catch(() => [])) actById.set(a.activity_id, a);
  }
  for (const o of occ) {
    const day = dayByDate.get(iso(o.date));
    const a = actById.get(o.activity_id);
    if (day && a) {
      day.occurrences.push({
        occurrence_id: o.occurrence_id,
        activity_id: o.activity_id,
        title: a.title,
        kind: a.kind,
        status: o.status,
        time_of_day: a.schedule?.time_of_day,
        steps: stepCounts.get(o.occurrence_id),
        // User rows only: system rows (weigh-ins, meal logs) never get a session, so "not ready"
        // would be a permanent false alarm on them.
        ...(a.kind === 'user' ? { session_ready: stepCounts.has(o.occurrence_id) } : {}),
        ...(a.goal_id && goalById.get(a.goal_id)?.area ? { area: goalById.get(a.goal_id)!.area } : {}),
      });
    }
  }
  for (const day of days) {
    day.occurrences.sort((x, y) => (x.time_of_day ?? '99').localeCompare(y.time_of_day ?? '99'));
  }

  // A day past the week's end that still has nothing written (the top-up above failed, or the
  // plan's rhythm is sparse) is behind the wall on the trail; draw the rhythm on it as a preview
  // so the wall shows what the check-in will confirm, instead of a week that looks like it stopped.
  const weekState = computeWeekState(plan, timezone ?? tzHint ?? null, now);
  projectPreview(
    days,
    activities,
    goalById,
    iso(plan.generated_at),
    previewFromDate(weekState?.ends_on, todayIso, weekState?.built_through),
  );

  // Rolling-window consistency over the LAST 7 days (days with ≥1 completion) — `past` was
  // fetched in the batch above.
  const { kept, window } = rollingConsistency(past, now, 7);

  return {
    hasPlan: true,
    stage: 'committed',
    version: plan.version,
    committedAt: plan.generated_at,
    ...(plan.rationale ? { rationale: plan.rationale } : {}),
    // Exclude the "Off-plan" bucket + episode-temp activities from the committed-rhythm list — their
    // occurrences still render in the week (via actById above), but they aren't the plan the user set.
    activities: activities
      .filter((a) => !a.category || !NON_PLAN_CATEGORIES.has(a.category))
      .map((a) => ({
        activity_id: a.activity_id,
        ...(a.commitment_id ? { commitment_id: a.commitment_id } : {}),
        title: a.title,
        kind: a.kind,
        cadence: describeRecurrence(a.schedule?.recurrence ?? ''),
        recurrence: a.schedule?.recurrence ?? '',
        time_of_day: a.schedule?.time_of_day,
        duration_min: a.schedule?.duration_min,
        ...(a.why ? { why: a.why } : {}),
        ...(a.goal_id
          ? {
              goal_id: a.goal_id,
              goal_title: goalById.get(a.goal_id)?.title,
              area: goalById.get(a.goal_id)?.area,
            }
          : {}),
        ...(a.suggested ? { suggested: true } : {}),
      })),
    week: days,
    consistency: { kept, window },
    streak,
    activeEpisode,
    pendingProposal: user?.pending_proposal ?? null,
    weekState,
  };
}
