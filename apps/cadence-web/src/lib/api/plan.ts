import type { PendingPlanActivity, ProgressData, StreakView } from '@cadence/shared';
import { BASE, headers } from './http.ts';

/* ── Ongoing plan view (Today / Your week) ─────────────────────── */
export interface PlanOccurrence {
  occurrence_id: string;
  activity_id: string;
  title: string;
  kind: 'user' | 'system';
  status: 'pending' | 'done' | 'skipped' | 'missed' | 'paused';
  time_of_day?: string;
  steps?: number; // prescribed-step count (from a cached session) — the trail's step ring
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
  const res = await fetch(`${BASE}/plan`, { headers: headers() }).catch(() => null);
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
 * Preview what "Adjust my plan" would build — synthesized + vetted but not committed. The banner
 * (`reason` + `suggested_levers`) already shows the "why" before the user ever sees this button;
 * previewPlan() + dismissPlanPreview() on the manual button is a separate, un-gated action, so
 * IT gets its own preview step here.
 */
export interface ReplanPreview {
  status: 'proposed' | 'vetoed';
  proposal?: { activities: PendingPlanActivity[]; note: string };
  violations?: string[];
}
export async function previewReplan(steer?: string): Promise<ReplanPreview> {
  const res = await fetch(`${BASE}/plan/replan/preview`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ steer: steer?.trim() || undefined }),
  });
  return res.json();
}
export async function dismissReplanPreview(): Promise<void> {
  await fetch(`${BASE}/plan/replan/preview/dismiss`, { method: 'POST', headers: headers() });
}
/** The stored pending proposal, if the server finished a preview our fetch didn't live to see. */
export async function getPendingReplan(): Promise<{
  proposal: { activities: PendingPlanActivity[]; note: string; rationale?: string } | null;
}> {
  const res = await fetch(`${BASE}/plan/replan/pending`, { headers: headers() });
  if (!res.ok) return { proposal: null };
  return res.json();
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
export async function getProgress(): Promise<ProgressData> {
  const res = await fetch(`${BASE}/progress`, { headers: headers() });
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
