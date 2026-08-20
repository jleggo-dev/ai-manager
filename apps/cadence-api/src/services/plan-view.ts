import type { OccurrenceStatus, PendingProposal, StreakView } from '@cadence/shared';
import { getActivePlan } from '../repos/plans.ts';
import { listActivities, NON_PLAN_CATEGORIES } from '../repos/activities.ts';
import { listOccurrences, listSessionStepCounts } from '../repos/occurrences.ts';
import { getActiveEpisode } from '../repos/episodes.ts';
import { getUser } from '../repos/users.ts';
import { getLatestConversation } from '../repos/conversations.ts';
import { listGoals } from '../repos/goals.ts';
import { ensureHorizon } from './plan-horizon.ts';
import { describeRecurrence } from './scheduling.ts';
import { rollingConsistency } from './metrics.ts';
import { evaluateStreak } from './streak.ts';
import { planDayBase } from './plan-day.ts';

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface PlanViewOccurrence {
  occurrence_id: string;
  activity_id: string;
  title: string;
  kind: 'user' | 'system';
  status: OccurrenceStatus;
  time_of_day?: string;
  steps?: number; // prescribed-item count from a cached session (drives the trail's step ring)
}
export interface PlanViewDay {
  date: string; // YYYY-MM-DD
  weekday: string; // 'Mon'
  dayNum: number; // 6
  isToday: boolean;
  occurrences: PlanViewOccurrence[];
}
export interface PlanViewActivity {
  activity_id: string;
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
}

/** The slim "you're on a detour" shape the Today/Week view needs — the full episode isn't sent. */
export interface ActiveEpisodeView {
  type: 'travel' | 'illness' | 'injury' | 'recovery' | 'custom';
  start: string;
  end: string;
  /** Has the equipment question been ANSWERED — by words, photo, or at entry? Distinct from the
   *  list being empty: "no gym here" is an answer, silence is not. Drives the arrival card. */
  gearKnown: boolean;
}

/** Neutral view when the streak evaluation itself fails — never let it break the plan load. */
const EMPTY_STREAK: StreakView = { current: 0, longest: 0, freezes: 0, savedByFreeze: false };

const iso = (d: string | Date): string => new Date(d).toISOString().slice(0, 10);

/**
 * Assemble the ongoing "Today / Your week" view from the active plan. Tops up the rolling horizon
 * first so the week is always materialized, then groups this week's occurrences by day and reports
 * rolling-window consistency (days you showed up, never a streak that resets).
 */
export async function buildPlanView(
  userId: string,
  weekDays = 7,
  /** The caller's own zone, used only when the user has none stored — 94 of 96 rows today. */
  tzHint?: string | null,
): Promise<PlanView> {
  await ensureHorizon(userId).catch(() => {
    /* best-effort top-up; view still renders from what's materialized */
  });

  /**
   * Everything the horizon top-up unblocks, at once (PERF-05).
   *
   * These four reads are independent of each other and were awaited one after another, which on a
   * cross-country hop is four full round trips for no reason: measured 2026-08-20, a bare query
   * costs ~181ms through the pooler, and GET /plan spent 2.0-3.8s running ~11 of them in series.
   * The dependency graph is much shallower than the old sequence implied — only `activities`
   * genuinely needs `plan`, and only the day window needs `user` (for the timezone).
   *
   * Each keeps its OWN catch, deliberately: `Promise.all` rejects on the first failure, so a
   * shared one would turn a missing episode into a failed screen. The per-call fallbacks below
   * are the same ones these calls always had.
   *
   * Streak still runs after `ensureHorizon` (it reads occurrences, so today's must be
   * materialized first) and is still reported by both the no-plan and committed branches.
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
      consistency: { kept: 0, window: weekDays },
      streak,
      activeEpisode,
      pendingProposal: null,
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
  for (let i = 0; i < weekDays; i++) {
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
  /**
   * The week, its step counts, and the trailing week for consistency — one round trip, not three
   * (PERF-05). All three depend only on the day window just computed, and on nothing from each
   * other; awaiting them in series was three cross-country hops to build one screen.
   */
  const pastFrom = iso(new Date(base - 6 * 86_400_000));
  const pastTo = iso(new Date(base));
  const [occ, stepRows, past] = await Promise.all([
    listOccurrences(userId, from, to),
    listSessionStepCounts(userId, from, to),
    listOccurrences(userId, pastFrom, pastTo),
  ]);
  const stepCounts = new Map(stepRows.map((r) => [r.occurrence_id, r.steps]));
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
      });
    }
  }
  for (const day of days) {
    day.occurrences.sort((x, y) => (x.time_of_day ?? '99').localeCompare(y.time_of_day ?? '99'));
  }

  // Rolling-window consistency over the LAST 7 days (days with ≥1 completion) — `past` was
  // fetched in the batch above.
  const { kept, window } = rollingConsistency(past, now, 7);

  // Resolve goal links so the card can group "Toward <goal>" and colour by area without a second fetch.
  const goalById = new Map(goalsList.map((g) => [g.goal_id, g]));

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
  };
}
