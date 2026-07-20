import type { PendingPlanActivity, ProgressData } from '@cadence/shared';
import { BASE, headers } from './http.ts';

/* ── Ongoing plan view (Today / Your week) ─────────────────────── */
export interface PlanOccurrence {
  occurrence_id: string;
  activity_id: string;
  title: string;
  kind: 'user' | 'system';
  status: 'pending' | 'done' | 'skipped' | 'missed';
  time_of_day?: string;
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
}
export interface PlanViewData {
  hasPlan: boolean;
  stage: 'new' | 'in_progress' | 'committed';
  version?: number;
  committedAt?: string;
  activities: PlanActivity[];
  week: PlanDay[];
  consistency: { kept: number; window: number };
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
