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
  duration_min?: number;
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
  activities: PlanActivity[];
  week: PlanDay[];
  consistency: { kept: number; window: number };
  // The protected streak (Req 4) — beside consistency, never instead of it. Optional so the
  // "no data" fallbacks below stay valid; the live API always includes it.
  streak?: StreakView;
  activeEpisode?: ActiveEpisode | null; // set while the user is on a disrupted detour (Req 4)
  pendingProposal?: PendingProposal | null;
}

export async function getPlan(): Promise<PlanViewData> {
  const res = await fetch(`${BASE}/plan`, { headers: headers() });
  if (!res.ok) return { hasPlan: false, stage: 'new', activities: [], week: [], consistency: { kept: 0, window: 7 } };
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

/** Enter a disrupted detour (Req 4): the base plan pauses for the window and lighter options
 *  appear. `days` defaults server-side to a week. */
export async function enterEpisode(
  type: ActiveEpisode['type'],
  opts?: { days?: number; end?: string; tone?: 'gentle' | 'supportive' },
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
