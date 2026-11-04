import type { ExerciseHistoryLine } from '@cadence/shared';
import { BASE, headers, timeoutSignal } from './http.ts';

/**
 * The last few times the person logged one exercise (routes/plan-exercise-history.ts): the Change
 * sheet's "Last 3 × 10 · 25 lb · Oct 28" rows and the weight sheet's "last time" chip. Facts, newest
 * first; the sheet writes the words. A read that failed is `ok: false`, never an empty list — an
 * empty list means New, and a dead network is not that.
 */
export type ExerciseHistoryResult = { ok: true; lines: ExerciseHistoryLine[] } | { ok: false };

export async function getExerciseHistory(opts: {
  exercise: string;
  activity?: string;
  limit?: number;
}): Promise<ExerciseHistoryResult> {
  const q = new URLSearchParams({ exercise: opts.exercise });
  if (opts.activity) q.set('activity', opts.activity);
  if (opts.limit) q.set('limit', String(opts.limit));
  const res = await fetch(`${BASE}/plan/exercise-history?${q}`, {
    headers: headers(),
    signal: timeoutSignal(8_000),
  }).catch(() => null);
  if (!res?.ok) return { ok: false };
  const body = (await res.json().catch(() => null)) as { lines?: unknown } | null;
  return Array.isArray(body?.lines) ? { ok: true, lines: body.lines as ExerciseHistoryLine[] } : { ok: false };
}
