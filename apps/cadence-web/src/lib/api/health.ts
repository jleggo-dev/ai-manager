import type { HealthDigest, WorkoutHistoryEntry } from '@cadence/shared';
import { BASE, headers } from './http.ts';

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
