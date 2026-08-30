import type { OccurrenceStatus, RhythmPayload } from '@cadence/shared';
import { BASE, headers } from './http.ts';

/** One occurrence's date + status — the raw per-date read `GET /progress/history` returns
 *  (ALL statuses, unlike the dashboard's done-only reads). */
export interface HistoryOccurrence {
  date: string;
  status: OccurrenceStatus;
}

export interface HistoryEpisodeRange {
  start: string;
  end: string;
  type: 'travel' | 'illness' | 'injury' | 'recovery' | 'custom';
}

/**
 * `GET /progress/history` response: the rhythm widget's raw inputs (occurrences, check-in days,
 * episode ranges — over the literal [from, to] requested) alongside the already-assembled
 * `RhythmPayload` (server-computed, week-aligned) so the client never re-derives the bucketing.
 */
export interface ProgressHistory {
  from: string;
  to: string;
  occurrences: HistoryOccurrence[];
  check_ins: string[];
  episodes: HistoryEpisodeRange[];
  rhythm: RhythmPayload;
}

/** `from`/`to` are YYYY-MM-DD; the server rejects a span over 400 days. */
export async function getProgressHistory(from: string, to: string): Promise<ProgressHistory> {
  const q = new URLSearchParams({ from, to });
  const res = await fetch(`${BASE}/progress/history?${q}`, { headers: headers() });
  if (!res.ok) throw new Error(`progress history failed: ${res.status}`);
  return res.json();
}
