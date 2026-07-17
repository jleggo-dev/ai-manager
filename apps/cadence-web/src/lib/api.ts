/**
 * Cadence API client. Talks to @cadence/api. In dev the backend resolves the user
 * from CADENCE_DEV_USER_ID, so no token is required; later, set the Supabase JWT via
 * setAuthToken. NEVER calls AI Admin directly and NEVER holds aim_sk_.
 */
import type { Goal, Equipment, Baseline, GoalAssessment, PendingPlanActivity, OccurrenceSession, OccurrenceLog, ProgressData } from '@cadence/shared';

const BASE = import.meta.env.VITE_CADENCE_API_BASE ?? '/api';

let authToken: string | null = null;
export function setAuthToken(token: string | null) {
  authToken = token;
}

/**
 * Dev-only account selector (real auth deferred). Two interchangeable scratch accounts, chosen
 * via the X-Cadence-Dev-User header; the backend maps the slug to a fixed user id (allowlisted
 * server-side). No effect once real auth lands.
 */
const ACCOUNT_KEY = 'cadence.devAccount';
export const DEV_ACCOUNTS = ['account-1', 'account-2'] as const;
export type DevAccount = (typeof DEV_ACCOUNTS)[number];
export const DEV_ACCOUNT_LABELS: Record<DevAccount, string> = {
  'account-1': 'Account 1',
  'account-2': 'Account 2',
};
export function getDevAccount(): DevAccount {
  const a = localStorage.getItem(ACCOUNT_KEY);
  return (DEV_ACCOUNTS as readonly string[]).includes(a ?? '') ? (a as DevAccount) : 'account-1';
}
export function setDevAccount(a: DevAccount) {
  localStorage.setItem(ACCOUNT_KEY, a);
}

/**
 * Dev mode = `?dev=1` in the URL. In dev mode the app skips real auth and talks to the backend as
 * a named dev account (via X-Cadence-Dev-User); otherwise it sends the Supabase JWT as a Bearer
 * token. Read straight from the URL so it needs no wiring — the backend independently ignores the
 * dev header in production (CADENCE_DEV_USER_ID unset), so this can't be a prod auth bypass.
 */
export function isDevMode(): boolean {
  return new URLSearchParams(window.location.search).get('dev') === '1';
}
/** Dev-only: wipe the current account's data (goals, plan, chat, baseline). */
export async function resetAccount(): Promise<void> {
  const res = await fetch(`${BASE}/dev/reset`, { method: 'POST', headers: headers() });
  if (!res.ok) throw new Error(`reset failed: ${res.status}`);
}

function headers(): HeadersInit {
  // Dev mode → identify as a named dev account (no real auth). Otherwise → the Supabase JWT.
  // Sending only one keeps the backend's two paths unambiguous.
  if (isDevMode()) {
    return { 'Content-Type': 'application/json', 'X-Cadence-Dev-User': getDevAccount() };
  }
  return {
    'Content-Type': 'application/json',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  };
}

export async function openCoachSession(
  opts: { intent?: string; topic?: string; systemPrompt?: string } = {},
): Promise<{ sessionId: string }> {
  const res = await fetch(`${BASE}/coach/sessions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(opts),
  });
  if (!res.ok) throw new Error(`openCoachSession failed: ${res.status}`);
  return res.json();
}

/** The user's current coach session + history (to restore the chat on refresh). `stale` = the
 *  server's freshness verdict (idle >7d, or an onboarding-era thread after the plan committed):
 *  the client should start a fresh thread and not render the old transcript. */
export async function getCurrentCoach(): Promise<{
  sessionId: string | null;
  messages: { role: 'user' | 'coach'; content: string }[];
  stale?: boolean;
  staleReason?: 'idle' | 'graduated' | null;
}> {
  const res = await fetch(`${BASE}/coach/current`, { headers: headers() });
  if (!res.ok) return { sessionId: null, messages: [] };
  return res.json();
}

/**
 * Send a message; calls onDelta as SSE chunks arrive. Resolves with `completed:true` when a
 * clean `[DONE]` is seen. If the stream ends WITHOUT `[DONE]` (a dropped connection mid-turn),
 * resolves with `completed:false` so the caller can recover the durably-persisted reply from
 * GET /coach/current. 409-safe: disable send until resolved.
 */
export async function sendCoachMessage(
  sessionId: string,
  message: string,
  onDelta: (text: string) => void,
): Promise<{ completed: boolean; responseId: string | null }> {
  const res = await fetch(`${BASE}/coach/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ message }),
  });
  if (!res.body) throw new Error('No stream body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let responseId: string | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break; // stream ended without [DONE] → interrupted
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return { completed: true, responseId };
      try {
        const p = JSON.parse(data);
        if (typeof p.responseId === 'string' && !responseId) responseId = p.responseId;
        // Control frames, not content deltas: `message.complete` carries the FULL reply text
        // (the server uses it for logging) and `v2.response.created` carries the id. Appending
        // their payload here would duplicate the whole message in the UI — skip them. Only
        // incremental `choices[].delta.content` frames carry streaming text.
        if (p.type === 'message.complete' || p.type === 'v2.response.created') continue;
        const delta = p.choices?.[0]?.delta?.content ?? '';
        if (delta) onDelta(delta);
      } catch {
        /* keepalive */
      }
    }
  }
  return { completed: false, responseId };
}

export interface ReviewData {
  name: string;
  goals: Goal[];
  equipment: Equipment[];
  baseline: Baseline;
  guardrail: { weightedLoad: number; activeCount: number; overFocusBudget: boolean; exceedsHardCap: boolean };
  confirmable: boolean;
  lockable: boolean;
}

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
  await fetch(`${BASE}/plan/occurrences/${id}`, { method: 'POST', headers: headers(), body: JSON.stringify({ status }) });
}

/* ── Occurrence session detail (the Prescribe → Log → Adapt sheet) ─── */
export interface OccurrenceDetail {
  occurrence_id: string;
  activity_id: string;
  date: string;
  status: 'pending' | 'done' | 'skipped' | 'missed';
  title: string;
  kind: 'user' | 'system';
  category?: string | null;
  schedule?: { recurrence: string; time_of_day?: string; duration_min?: number } | null;
  session?: OccurrenceSession | null;
  log?: OccurrenceLog | null;
  value?: Record<string, number>;
  why?: string | null; // the commitment's stored rationale — "why this session exists"
}

/**
 * Occurrence + the coach's concrete session (generated on first open — the slow path is one
 * coach-tier call, so callers show a loading state). Throws with status 404 after a replan
 * removed the row; the sheet turns that into "this session moved with your new plan".
 */
export async function getOccurrenceDetail(id: string): Promise<OccurrenceDetail> {
  const res = await fetch(`${BASE}/plan/occurrences/${id}`, { headers: headers() });
  if (!res.ok) throw Object.assign(new Error(`detail failed: ${res.status}`), { status: res.status });
  return res.json();
}

/** "How did it go?" — the user's own words; server parses, stores the log, marks it done. */
export async function logOccurrence(id: string, text: string): Promise<{ log: OccurrenceLog; summary: string }> {
  const res = await fetch(`${BASE}/plan/occurrences/${id}/log`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw Object.assign(new Error(`log failed: ${res.status}`), { status: res.status });
  return res.json();
}

/**
 * "Start over" — wipe THIS user's Cadence data (real-auth allowed; server re-verifies the typed
 * phrase). NOT account deletion: the login survives. In dev mode the Reset button uses /dev/reset.
 */
export async function deleteMyData(confirmPhrase: string): Promise<boolean> {
  const res = await fetch(`${BASE}/me/data`, {
    method: 'DELETE',
    headers: headers(),
    body: JSON.stringify({ confirm: confirmPhrase }),
  });
  return res.ok;
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

/* ── Nutrition (Observe phase) ─────────────────────────────────── */
export type MealKind = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'drink' | 'other';
export interface Meal {
  log_id: string;
  date: string;
  meal: MealKind;
  items: { name: string; qty?: number; unit?: string }[];
  raw_text?: string | null;
  flags?: { alcohol?: boolean; caffeine?: boolean };
}

/** Record one meal in the user's words — parse-meal structures it; nothing is ever judged. */
export async function logMeal(text: string, meal?: MealKind): Promise<Meal> {
  const res = await fetch(`${BASE}/nutrition/meals`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ text, ...(meal ? { meal } : {}) }),
  });
  if (!res.ok) throw Object.assign(new Error(`meal log failed: ${res.status}`), { status: res.status });
  return res.json();
}

/** Recent meals, newest first (the food-log sheet's list). */
export async function getRecentMeals(days = 7): Promise<Meal[]> {
  const res = await fetch(`${BASE}/nutrition/recent?days=${days}`, { headers: headers() });
  if (!res.ok) return [];
  const body = (await res.json()) as { meals?: Meal[] };
  return body.meals ?? [];
}

export type BaselineRead =
  | { ready: false; days_logged: number; days_needed: number }
  | { ready: true; read: string; suggestion: string; rationale: string };

/** The Baseline moment — the coach's pattern read + ONE gradual change (7+ observed days). */
export async function getBaselineRead(): Promise<BaselineRead> {
  const res = await fetch(`${BASE}/nutrition/baseline`, { method: 'POST', headers: headers() });
  if (!res.ok) throw Object.assign(new Error(`baseline failed: ${res.status}`), { status: res.status });
  return res.json();
}

/** Weigh-in capture (deterministic, no LLM) — stores the series point + updates baseline. */
export async function recordWeighIn(id: string, weight: number, unit: 'kg' | 'lb'): Promise<{ weight_kg: number }> {
  const res = await fetch(`${BASE}/plan/occurrences/${id}/weigh-in`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ weight, unit }),
  });
  if (!res.ok) throw Object.assign(new Error(`weigh-in failed: ${res.status}`), { status: res.status });
  return res.json();
}

/** Confirm the previewed "Adjust my plan" adjustment (or run it fresh if nothing was previewed). */
export async function replan(): Promise<{ status: string; version?: number; activities?: number; note?: string; violations?: string[] }> {
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
export async function acceptProposal(): Promise<{ status: string; version?: number; activities?: number; note?: string; violations?: string[] }> {
  const res = await fetch(`${BASE}/plan/proposal/accept`, { method: 'POST', headers: headers() });
  return res.json();
}

/** Decline the coach's proactive weekly proposal; it re-assesses again next week. */
export async function dismissProposal(): Promise<void> {
  await fetch(`${BASE}/plan/proposal/dismiss`, { method: 'POST', headers: headers() });
}

export async function getReview(): Promise<ReviewData> {
  const res = await fetch(`${BASE}/review`, { headers: headers() });
  if (!res.ok) throw new Error(`getReview failed: ${res.status}`);
  return res.json();
}

export async function confirmGoals(): Promise<{ confirmed: number }> {
  const res = await fetch(`${BASE}/review/confirm`, { method: 'POST', headers: headers() });
  if (!res.ok) throw new Error(`confirm failed: ${res.status}`);
  return res.json();
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

/* ── Review wizard: accept / reject / modify captured data ─────── */
export async function updateGoal(goalId: string, fields: Partial<Goal>): Promise<void> {
  await fetch(`${BASE}/review/goals/${goalId}`, { method: 'PATCH', headers: headers(), body: JSON.stringify(fields) });
}
/** Coach's realism read on a goal + proposed stepping-stones (suggest-only). null if unavailable. */
export async function assessGoal(goalId: string): Promise<GoalAssessment | null> {
  const res = await fetch(`${BASE}/review/goals/${goalId}/assess`, { method: 'POST', headers: headers() });
  if (!res.ok) return null;
  return res.json();
}
export async function deleteGoal(goalId: string): Promise<void> {
  await fetch(`${BASE}/review/goals/${goalId}`, { method: 'DELETE', headers: headers() });
}
/** `confirm: true` (Settings manage mode) inserts as CONFIRMED — replan-visible + capture-immune. */
export async function addGoal(fields: Partial<Goal> & { confirm?: boolean }): Promise<Goal> {
  const res = await fetch(`${BASE}/review/goals`, { method: 'POST', headers: headers(), body: JSON.stringify(fields) });
  if (!res.ok) throw new Error(`addGoal failed: ${res.status}`);
  return res.json();
}
export async function updateEquipment(id: string, fields: Partial<Equipment>): Promise<void> {
  await fetch(`${BASE}/review/equipment/${id}`, { method: 'PATCH', headers: headers(), body: JSON.stringify(fields) });
}
export async function deleteEquipmentItem(id: string): Promise<void> {
  await fetch(`${BASE}/review/equipment/${id}`, { method: 'DELETE', headers: headers() });
}
export async function addEquipment(fields: Partial<Equipment>): Promise<Equipment> {
  const res = await fetch(`${BASE}/review/equipment`, { method: 'POST', headers: headers(), body: JSON.stringify(fields) });
  if (!res.ok) throw new Error(`addEquipment failed: ${res.status}`);
  return res.json();
}
export async function updateBaseline(patch: Partial<Baseline>): Promise<void> {
  await fetch(`${BASE}/review/baseline`, { method: 'PATCH', headers: headers(), body: JSON.stringify(patch) });
}
export async function updateName(name: string): Promise<void> {
  await fetch(`${BASE}/review/profile`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ name }) });
}

/* ── Dev "X-ray" trace ─────────────────────────────────────────── */
export interface DevTrace {
  updatedAt?: string;
  empty?: boolean;
  persona?: string | null;
  context?: {
    mode: string;
    selectReason: string;
    provenance: Array<{ fn: string; rows: number; params: Record<string, unknown> }>;
    data: Record<string, unknown>;
    rendered: string;
  } | null;
  brokerSelect?: { calls: Array<{ fn: string; params: Record<string, unknown> }>; reason: string } | null;
  brokerSummarize?: { output: string } | null;
  turnSelect?: {
    calls: Array<{ fn: string; params: Record<string, unknown> }>;
    reason: string;
    injected: boolean;
    provenance: Array<{ fn: string; rows: number; params: Record<string, unknown>; at?: string }>;
    fallback?: boolean;
  } | null;
  coach?: { user: string; reply: string; model: string | null; promptTokens: number | null; completionTokens: number | null } | null;
  capture?: unknown;
}

export async function getTrace(): Promise<DevTrace> {
  const res = await fetch(`${BASE}/coach/trace`, { headers: headers() });
  if (!res.ok) throw new Error(`getTrace failed: ${res.status}`);
  return res.json();
}

export interface AiLogEntry {
  kind: string;
  input: unknown;
  output: unknown;
  meta: unknown;
  created_at: string;
}
export async function getCoachLog(): Promise<{ entries: AiLogEntry[] }> {
  const res = await fetch(`${BASE}/coach/log`, { headers: headers() });
  if (!res.ok) return { entries: [] };
  return res.json();
}
