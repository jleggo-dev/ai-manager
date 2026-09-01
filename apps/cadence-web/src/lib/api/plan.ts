import type {
  OccurrenceStatus,
  PendingPlanActivity,
  PendingWeekReview,
  ProgressData,
  ProgressWindow,
  RhythmWeek,
  StreakView,
  WeeklyBarsPayload,
} from '@cadence/shared';
import { BASE, headers, timeoutSignal } from './http.ts';

/* ── Ongoing plan view (Today / Your week) ─────────────────────── */
export interface PlanOccurrence {
  occurrence_id: string;
  activity_id: string;
  title: string;
  kind: 'user' | 'system';
  status: 'pending' | 'done' | 'skipped' | 'missed' | 'paused';
  time_of_day?: string;
  steps?: number; // prescribed-step count (from a cached session) — the trail's step ring
  /** The linked goal's area — the icon family's source of truth (title regex is the fallback). */
  area?: 'movement' | 'nourishment' | 'mind' | 'practice';
}

/** The "you're on a detour" summary (Req 4) — set while a disrupted episode is active. */
export interface ActiveEpisode {
  type: 'travel' | 'illness' | 'injury' | 'recovery' | 'custom';
  start: string;
  end: string;
  /** Answered — by words, photo, or at entry. Empty-list "no gym" counts; silence does not. */
  gearKnown: boolean;
}
export interface PlanDay {
  date: string;
  weekday: string;
  dayNum: number;
  isToday: boolean;
  occurrences: PlanOccurrence[];
}
export interface PlanActivity {
  activity_id: string;
  title: string;
  kind: 'user' | 'system';
  cadence: string;
  recurrence: string;
  time_of_day?: string;
  /** Minutes of the effort itself, not the whole session — see `ActivitySchedule.duration_min`.
   *  Pair it with `sessionBudget(duration_min, area)` to show the time to actually set aside. */
  duration_min?: number;
  /** The coach's rationale for THIS commitment, 1-3 sentences — the pre-signup card renders it. */
  why?: string;
  /** Objective link for grouping "Toward <goal>"; absent → Foundations. */
  goal_id?: string;
  goal_title?: string;
  /** The linked goal's area — colours the card's dots. Absent for system/foundational rows. */
  area?: 'movement' | 'nourishment' | 'mind' | 'practice';
  /** She proposed this herself (adjacent support). Badge it on the card only — the consent
   *  moment — never as a permanent asterisk on Week/Today (owner ruling 2026-08-12). */
  suggested?: boolean;
}
export interface PendingProposal {
  reason: string;
  suggested_levers: string[];
  created_at: string;
  action?: 'replan' | 'enter_disrupted' | 'rebaseline'; // undefined = replan (Req 4)
  episode_type?: ActiveEpisode['type'];
}
export interface PlanViewData {
  hasPlan: boolean;
  stage: 'new' | 'in_progress' | 'committed';
  version?: number;
  committedAt?: string;
  /** The coach's whole-shape reasoning — the card's "why this shape" reveal. */
  rationale?: string;
  activities: PlanActivity[];
  week: PlanDay[];
  consistency: { kept: number; window: number };
  // The protected streak (Req 4) — beside consistency, never instead of it. Optional so the
  // "no data" fallbacks below stay valid; the live API always includes it.
  streak?: StreakView;
  activeEpisode?: ActiveEpisode | null; // set while the user is on a disrupted detour (Req 4)
  pendingProposal?: PendingProposal | null;
  /** Named `weekState`, not `week` — `week: PlanDay[]` above already owns that name. Null before
   *  a plan exists. `checkin_due` drives the end-of-trail card (check-in rebuild, step 6). */
  weekState?: { ends_on: string; checkin_due: boolean } | null;
}

/**
 * The plan, or `null` when it could not be loaded. The distinction is the whole point: this used
 * to answer any non-OK response with `stage: 'new'` — the exact shape of a brand-new user — so a
 * cold serverless start or a 401 blip right after sign-in dressed a signed-in person with a full
 * plan as someone who had never been here, and the app "restarted onboarding" at them (owner,
 * 2026-08-19). "I could not load your plan" and "you have no plan" must never share a value.
 */
export async function getPlan(): Promise<PlanViewData | null> {
  // 15s is ~75× the measured endpoint (median ~200ms deployed) and still short enough that a
  // suspended-socket hang becomes a retryable failure instead of a minutes-long skeleton.
  const res = await fetch(`${BASE}/plan`, { headers: headers(), signal: timeoutSignal(15_000) }).catch(() => null);
  if (!res?.ok) return null;
  return res.json();
}

export async function setOccurrence(id: string, status: 'pending' | 'done' | 'skipped'): Promise<void> {
  await fetch(`${BASE}/plan/occurrences/${id}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ status }),
  });
}

/** Log something you did that wasn't on the plan (Req 4) → a done occurrence for the day, so it
 *  counts toward consistency + the streak. `date` optional (YYYY-MM-DD), defaults to today. */
export async function logAdhoc(text: string, date?: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/plan/occurrences/adhoc`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ text, date }),
  });
  return { ok: res.ok };
}

/**
 * Goal-aware "log something you did" (the ＋ FAB): credit a PLANNED activity as done for the day
 * (default today), so it counts toward that goal + streak even if it was scheduled for another day.
 * `text` optional — the coach records "Did {title}" when omitted.
 */
export async function logDid(activityId: string, text?: string, date?: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/plan/activities/${activityId}/did`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ text, date }),
  });
  return { ok: res.ok };
}

/**
 * Enter a disrupted detour (Req 4): the base plan pauses for the window and what survives of it
 * appears instead.
 *
 * `days` and `available_equipment` are the two facts the coach cannot draft without — a detour is
 * about preserving the habits that CAN be preserved when the schedule is thrown out, and without
 * the window and the gear it is guessing at both. Omitting equipment means "nothing", which is a
 * real answer (a week with no gym at all) but a bad default.
 */
export async function enterEpisode(
  type: ActiveEpisode['type'],
  opts?: {
    days?: number;
    end?: string;
    tone?: 'gentle' | 'supportive';
    available_equipment?: { name: string }[];
  },
): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/plan/episode`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ type, ...opts }),
  });
  return { ok: res.ok };
}

/** End the active detour; the base plan resumes from today. */
export async function endEpisode(): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/plan/episode/end`, { method: 'POST', headers: headers() });
  return { ok: res.ok };
}

/** The explicit "I'm here" (Req 4) — showing up keeps the streak alive on a rough day. */
export async function checkin(): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/plan/checkin`, { method: 'POST', headers: headers() });
  return { ok: res.ok };
}

/** Confirm the previewed "Adjust my plan" adjustment (or run it fresh if nothing was previewed). */
export async function replan(): Promise<{
  status: string;
  version?: number;
  activities?: number;
  note?: string;
  violations?: string[];
}> {
  const res = await fetch(`${BASE}/plan/replan`, { method: 'POST', headers: headers() });
  return res.json();
}

/**
 * Start the "Adjust my plan" synthesis. It runs server-side behind a durable run record and
 * SURVIVES this client leaving: the endpoint answers 202 `{running: true}` the moment the run is
 * recorded (`joined: true` when the tap landed on a run already in flight — same thing, keep
 * polling). The verdict — proposal, or failure in the server's words — always arrives via
 * `getPendingReplan()`; this call never carries one.
 *
 * `res.ok` is checked deliberately: a 500 used to parse straight into the vetoed branch, which
 * dressed a recoverable failure as a terminal "Try again" after 4½ minutes of waiting
 * (2026-08-31). `invalid` marks a definite 400 — the request itself was malformed, so no run
 * exists and polling for one would be waiting for nothing.
 */
export interface ReplanPreview {
  ok: boolean;
  running?: boolean;
  joined?: boolean;
  invalid?: boolean;
  /** The 400's own words, when it sent any. */
  error?: string;
}
export async function previewReplan(steer?: string): Promise<ReplanPreview> {
  try {
    const res = await fetch(`${BASE}/plan/replan/preview`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ steer: steer?.trim() || undefined }),
    });
    if (res.status === 400) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, invalid: true, error: body?.error };
    }
    if (!res.ok) return { ok: false };
    const body = (await res.json()) as { running?: boolean; joined?: boolean };
    return { ok: true, running: !!body.running, joined: !!body.joined };
  } catch {
    // Thrown fetch = network-level UNKNOWN — the caller polls pending rather than concluding.
    return { ok: false };
  }
}
export async function dismissReplanPreview(): Promise<void> {
  await fetch(`${BASE}/plan/replan/preview/dismiss`, { method: 'POST', headers: headers() });
}
/** The live run's stage report, verbatim from the server's durable run record. */
export interface ReplanRun {
  stage: 'reading' | 'drafting' | 'saving';
  startedAt: string;
}

/**
 * The replan run's whole story, read from the server: exactly one of a finished `proposal`, a
 * `running` record (with the stage she is actually in), a `failed` record (worth showing — the
 * run can be reclaimed with a fresh preview POST), or none of the three (nothing on file).
 *
 * `ok` keeps failure and "nothing pending" apart (additive — existing callers read `proposal`
 * unchanged). The paint-before-auth boot fires mount-time reads before the bearer token exists,
 * and a 401 swallowed into `proposal: null` made a finished rebalance invisible until the owner
 * happened to leave the screen and come back (2026-08-31, the avatar lesson relearned): a failed
 * read is UNKNOWN, and an unknown is worth retrying — an empty answer is not.
 */
export async function getPendingReplan(): Promise<{
  ok: boolean;
  proposal: { activities: PendingPlanActivity[]; note: string; rationale?: string } | null;
  running?: ReplanRun;
  failed?: { message: string };
}> {
  try {
    const res = await fetch(`${BASE}/plan/replan/pending`, { headers: headers() });
    if (!res.ok) return { ok: false, proposal: null };
    const body = (await res.json()) as {
      proposal: { activities: PendingPlanActivity[]; note: string; rationale?: string } | null;
      running?: ReplanRun;
      failed?: { message: string };
    };
    return { ok: true, proposal: body.proposal ?? null, running: body.running, failed: body.failed };
  } catch {
    return { ok: false, proposal: null };
  }
}

/**
 * Accept the coach's proactive weekly proposal — commits directly (no separate preview step):
 * the banner's `reason` + `suggested_levers` are already shown before Accept, so that IS the
 * consent moment; a second preview here would just be redundant friction.
 */
export async function acceptProposal(): Promise<{
  status: string;
  version?: number;
  activities?: number;
  note?: string;
  violations?: string[];
}> {
  const res = await fetch(`${BASE}/plan/proposal/accept`, { method: 'POST', headers: headers() });
  return res.json();
}

/** Decline the coach's proactive weekly proposal; it re-assesses again next week. */
export async function dismissProposal(): Promise<void> {
  await fetch(`${BASE}/plan/proposal/dismiss`, { method: 'POST', headers: headers() });
}

export interface PendingChange {
  changes: string[];
  activities: number;
  created_at: string;
}

/**
 * The change the coach has proposed but nobody has applied yet.
 *
 * Read from the server on purpose: the ChangeCard shows what `propose_plan_change` actually
 * computed, not what the turn announcing it claimed, so the thing the user agrees to is the thing
 * that commits.
 */
export async function getPendingChange(): Promise<PendingChange | null> {
  const res = await fetch(`${BASE}/plan/pending-change`, { headers: headers() });
  if (!res.ok) return null;
  const body = (await res.json()) as { change: PendingChange | null };
  return body.change;
}

/** "Not now" — drop the proposal. The plan is untouched and she can offer again. */
export async function dismissPendingChange(): Promise<boolean> {
  const res = await fetch(`${BASE}/plan/pending-change/dismiss`, { method: 'POST', headers: headers() });
  return res.ok;
}

/* ── Changes sheet (the swap-card toggle surface, check-in rebuild, step 7 client half) ────── */
export interface PendingChangeDetailItem {
  index: number;
  title: string;
  /** The coach's one-line why, when propose_plan_change was given one. Absent for an ordinary
   *  edit that carried no reason. */
  change_reason?: string;
  enabled: boolean;
  /** The active plan's current schedule for this commitment, summarized ("Thu · 6:30 pm"). Null
   *  for a pure add — there is no "now" for a commitment that doesn't exist yet. */
  now: string | null;
  next: string;
}
export interface PendingChangeDetail {
  /** The active plan's version, so the sheet can label the row "WEEK {version + 1}". Null when
   *  there is nothing pending. */
  plan_version: number | null;
  items: PendingChangeDetailItem[];
}

/**
 * The full per-item view the Changes sheet renders — every proposed swap's title, reason (if the
 * coach gave one), current enabled/disabled toggle state, and NOW → NEXT WEEK schedule. Same
 * fallback shape as getPendingChange: nothing pending (or a read that fails) is an empty list,
 * never a thrown error — the sheet has one honest "nothing to show" message for all of them.
 */
export async function getPendingChangeDetail(): Promise<PendingChangeDetail> {
  const res = await fetch(`${BASE}/plan/pending-change/detail`, { headers: headers() }).catch(() => null);
  if (!res?.ok) return { plan_version: null, items: [] };
  return res.json();
}

/**
 * Persist the sheet's toggle flips before applying. `index` addresses the STORED array position —
 * stable, because propose_plan_change never reorders it — so these survive to the commit funnel
 * (resolveToggledActivities in plan-partial-apply.ts) even though the tap that applies happens in
 * a separate call (lockPlan).
 */
export async function setPendingChangeToggles(toggles: { index: number; enabled: boolean }[]): Promise<boolean> {
  const res = await fetch(`${BASE}/plan/pending-change/toggles`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ toggles }),
  }).catch(() => null);
  return !!res?.ok;
}

/**
 * The week the coach's `open_week_review` tool put up, if it's still waiting to be opened or
 * dismissed. Read from the server, same reasoning as getPendingChange: the card shows the week
 * the TOOL actually pointed at, not whatever the turn that announced it said.
 */
export async function getPendingWeekReview(): Promise<PendingWeekReview | null> {
  const res = await fetch(`${BASE}/plan/week-review/pending`, { headers: headers() });
  if (!res.ok) return null;
  const body = (await res.json()) as { review: PendingWeekReview | null };
  return body.review;
}

/** Dismiss the week-review card without opening it. Nothing else was written by putting it up,
 *  so there is nothing else to undo — she can put another one up whenever asked. */
export async function dismissPendingWeekReview(): Promise<boolean> {
  const res = await fetch(`${BASE}/plan/week-review/dismiss`, { method: 'POST', headers: headers() });
  return res.ok;
}

/* ── Week review facts (check-in rebuild, step 4) ──────────────── */
/** Mirrors `week-review-facts.ts`'s server-side shape exactly — this is the client's own view of
 *  the same JSON, not a shared type, the same way `PlanDay`/`PlanActivity` above are the client's
 *  own reading of `/plan` rather than an import of a server-internal type. */
export type WeekReviewMeal = 'breakfast' | 'lunch' | 'dinner';
export interface WeekReviewMealSlot {
  meal: WeekReviewMeal;
  occurrence_id: string | null;
  logged: boolean;
}
export interface WeekReviewSessionRow {
  occurrence_id: string;
  title: string;
  status: OccurrenceStatus;
  planned_min?: number;
  logged_min?: number;
}
export interface WeekReviewMindStep {
  name: string;
  done: boolean;
}
export interface WeekReviewMindRow {
  occurrence_id: string;
  title: string;
  status: OccurrenceStatus;
  steps?: WeekReviewMindStep[];
  done?: boolean;
}
export interface WeekReviewDay {
  date: string;
  sessions: WeekReviewSessionRow[];
  meals: WeekReviewMealSlot[];
  mind: WeekReviewMindRow[];
}
export interface WeekReviewWeighIn {
  occurrence_id: string;
  date: string;
  status: string;
}
export interface WeekReviewFacts {
  period: { from: string; to: string };
  days: WeekReviewDay[];
  weigh_in: WeekReviewWeighIn | null;
  /** Progress Engine parcel W2-2 — additive, contract-shaped twins of `days` above; optional so a
   *  test fixture built before this field existed still type-checks. See the server's
   *  week-review-widgets.ts for what each one means; RollupCards.tsx for which is actually
   *  rendered and why the other stays a data-only addition for now. */
  rhythm_week?: RhythmWeek;
  meals_week?: WeeklyBarsPayload;
}

/**
 * The week the pending pointer names, computed in full — what the read-only review sheet
 * renders. `null` covers every reason it might not be there (nothing pending, a stale pointer
 * dismissed on another device, a server hiccup) the same way `getPendingChange`/`getPlan` already
 * collapse "couldn't load" and "nothing to load" into one falsy answer: the sheet has one honest
 * fallback message for all of them, not a diagnosis.
 *
 * `week` (Progress Engine parcel W2-2, YYYY-MM-DD — any date in the target week) is OPTIONAL and
 * unused by the sheet itself today (it still always opens the pending pointer's own week); it's
 * here so this one fetch stays the single client-side entry point for the server's new
 * `?week=` param, matching "extend the existing facts api fn in place, no new hooks."
 */
export async function getWeekReviewFacts(
  week?: string,
): Promise<{ review: PendingWeekReview; facts: WeekReviewFacts } | null> {
  const qs = week ? `?week=${encodeURIComponent(week)}` : '';
  const res = await fetch(`${BASE}/plan/week-review/facts${qs}`, { headers: headers() });
  if (!res.ok) return null;
  return res.json();
}

/* ── Week review write-back (check-in rebuild, step 5) ─────────────────────
   Plain writes onto the same rows `getWeekReviewFacts` reads. Each returns a bare `ok` — the
   sheet already holds the toggled value optimistically, so all a caller needs is whether the
   write actually landed (revert-on-false is the caller's job, not this fetch's). */

/** Confirm (or correct) a session row — done/skipped, optionally with minutes. The SAME route
 *  backs the week's weigh-in row: a weigh-in is just another occurrence to confirm. */
export async function confirmWeekReviewSession(
  occurrenceId: string,
  done: boolean,
  minutes?: number,
): Promise<boolean> {
  const res = await fetch(`${BASE}/plan/week-review/session`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ occurrence_id: occurrenceId, done, minutes }),
  });
  return res.ok;
}

/** Flip one day's meal slot logged/not. */
export async function toggleWeekReviewMeal(date: string, meal: WeekReviewMeal, logged: boolean): Promise<boolean> {
  const res = await fetch(`${BASE}/plan/week-review/meal`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ date, meal, logged }),
  });
  return res.ok;
}

/** Flip one named step of a mind/practice occurrence's checklist. */
export async function toggleWeekReviewMindStep(occurrenceId: string, step: string, done: boolean): Promise<boolean> {
  const res = await fetch(`${BASE}/plan/week-review/mind-step`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ occurrence_id: occurrenceId, step, done }),
  });
  return res.ok;
}

export async function lockPlan(): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${BASE}/plan/lock`, { method: 'POST', headers: headers() });
  return { status: res.status, body: await res.json() };
}

/**
 * Preview the plan the coach would build — synthesized + vetted but NOT committed. The user
 * reviews it, then either lockPlan() (confirm) or dismissPlanPreview() (go adjust goals first).
 */
export interface LockPreview {
  status: 'proposed' | 'needs_focus' | 'vetoed';
  proposal?: { activities: PendingPlanActivity[]; note: string };
  violations?: string[];
  guardrail?: { weightedLoad: number; activeCount: number };
}
export async function previewPlan(): Promise<LockPreview> {
  const res = await fetch(`${BASE}/plan/preview`, { method: 'POST', headers: headers() });
  return res.json();
}
export async function dismissPlanPreview(): Promise<void> {
  await fetch(`${BASE}/plan/preview/dismiss`, { method: 'POST', headers: headers() });
}

/* ── Progress dashboard ────────────────────────────────────────── */
/** `window` omitted keeps the ORIGINAL /progress behavior (backwards compatible — see the API's
 *  progress-window.ts). 'week' | 'month' | 'all' re-derives series/consistency/history sizing. */
export async function getProgress(window?: ProgressWindow): Promise<ProgressData> {
  const q = window ? `?window=${window}` : '';
  const res = await fetch(`${BASE}/progress${q}`, { headers: headers() });
  if (!res.ok) throw new Error(`progress failed: ${res.status}`);
  return res.json();
}

/** Manual "+1" on a count card ("finished Dune"). */
export async function addGoalEvent(goalId: string, label: string): Promise<void> {
  await fetch(`${BASE}/progress/events`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ goal_id: goalId, label }),
  });
}

/** The detour's equipment answer as pictures: parse what the gym photos show and re-draft the
 *  remaining days around it. 409 = no active detour. */
export async function sendGymPhotos(
  photos: string[],
): Promise<{ ok: boolean; saw?: string[]; revised?: boolean; note?: string }> {
  const res = await fetch(`${BASE}/plan/episode/equipment-photo`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ photos }),
  });
  if (!res.ok) return { ok: false };
  const body = (await res.json()) as { saw: string[]; revised: boolean; note?: string };
  return { ok: true, ...body };
}

/** The arrival card's gear answer in words — [] is the explicit "no gym here". */
export async function sendDetourEquipment(
  equipment: { name: string }[],
): Promise<{ ok: boolean; revised?: boolean; note?: string }> {
  const res = await fetch(`${BASE}/plan/episode/equipment`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ equipment }),
  });
  if (!res.ok) return { ok: false };
  return { ok: true, ...((await res.json()) as { revised: boolean; note?: string }) };
}

/** Arrival day but not arrived: push the detour's start a day. Past the end, it cancels. */
export async function postponeDetour(): Promise<{ ok: boolean; cancelled?: boolean }> {
  const res = await fetch(`${BASE}/plan/episode/not-yet`, { method: 'POST', headers: headers() });
  if (!res.ok) return { ok: false };
  return { ok: true, ...((await res.json()) as { cancelled?: boolean }) };
}

/**
 * "Just build my week — I trust you" (check-in rebuild, step 6): the end-of-trail card's trust
 * path. A commit, not a synthesis — no coach call, no preview step; the outgoing week's own
 * activities are recommitted as the next version. 409 with `status: 'no_plan' | 'not_due'` when
 * the guard on the other end declines (nothing to rebuild, or the week genuinely isn't over yet).
 */
export interface WeekBuildResult {
  status: 'committed' | 'no_plan' | 'not_due';
  planId?: string;
  version?: number;
  activities?: number;
  occurrences?: number;
  note?: string;
}
export async function buildNextWeek(): Promise<WeekBuildResult> {
  const res = await fetch(`${BASE}/plan/week/build`, { method: 'POST', headers: headers() });
  return res.json();
}
