import type { DatedSessionsPayload, HealthDigest, ProgressWindow, WorkoutHistoryEntry } from '@cadence/shared';
import { BASE, headers } from './http.ts';

/** One workout_history row as GET /me/workout-history returns it (mirrors repos/workout-history.ts's WorkoutHistoryRow). */
export interface WorkoutHistoryListItem {
  source: 'healthkit' | 'strava' | 'cadence';
  type: string;
  startedAt: string;
  durationMin: number | null;
  distanceKm: number | null;
  avgHr: number | null;
}

/**
 * A `dated_sessions` row, as GET /me/sessions returns it — a strict superset of the frozen
 * `DatedSession` contract (packages/cadence-shared/src/types/progress-widgets.ts): the server adds
 * `felt` for the drill-down list, which the contract type has no room for. See
 * apps/cadence-api/src/services/progress-sessions.ts for why this is additive, not a contract edit.
 */
export type DatedSessionListItem = DatedSessionsPayload['sessions'][number] & {
  felt?: 'easy' | 'right' | 'hard' | null;
};
export type DatedSessionsListResult = Omit<DatedSessionsPayload, 'sessions'> & { sessions: DatedSessionListItem[] };

/**
 * POST the confirm-first health digest. `sessionId` (when the coach session is already
 * open) lets the server inject it into the running conversation immediately.
 */
export async function postHealthDigest(digest: HealthDigest, sessionId?: string | null): Promise<boolean> {
  const res = await fetch(`${BASE}/me/health-digest`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ digest, ...(sessionId ? { sessionId } : {}) }),
  });
  return res.ok;
}

/** Latest stored digest + when it was shared (null when none). */
export async function getHealthDigest(): Promise<{ digest: HealthDigest | null; created_at: string | null }> {
  const res = await fetch(`${BASE}/me/health-digest`, { headers: headers() });
  if (!res.ok) return { digest: null, created_at: null };
  return res.json();
}

/**
 * Push workout ROWS alongside the digest (0033 dataset). Idempotent server-side — the whole
 * window travels every refresh and only new sessions become rows.
 */
export async function postWorkoutHistory(workouts: WorkoutHistoryEntry[]): Promise<boolean> {
  if (!workouts.length) return true;
  const res = await fetch(`${BASE}/me/workout-history`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ workouts }),
  });
  return res.ok;
}

/** The read side of the 0033 dataset (client GET was missing until W1-3). Newest first. */
export async function getWorkoutHistory(days = 90, limit = 60): Promise<WorkoutHistoryListItem[]> {
  const res = await fetch(`${BASE}/me/workout-history?days=${days}&limit=${limit}`, { headers: headers() });
  if (!res.ok) throw new Error('failed to load workout history');
  const data: { workouts: WorkoutHistoryListItem[] } = await res.json();
  return data.workouts;
}

/**
 * The `dated_sessions` widget's binding resolver — plan sessions merged with workout_history,
 * deduped (see services/progress-sessions.ts). Also the data source for the drill-down list
 * screen (SessionListScreen).
 */
export async function getDatedSessions(
  activity: string,
  window: ProgressWindow = 'all',
): Promise<DatedSessionsListResult> {
  const res = await fetch(`${BASE}/me/sessions?activity=${encodeURIComponent(activity)}&window=${window}`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error('failed to load sessions');
  return res.json();
}
