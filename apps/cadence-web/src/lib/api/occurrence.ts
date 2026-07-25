import type { OccurrenceSession, OccurrenceLog } from '@cadence/shared';
import { BASE, headers } from './http.ts';

/* ── Occurrence session detail (the Prescribe → Log → Adapt sheet) ─── */
export interface OccurrenceDetail {
  occurrence_id: string;
  activity_id: string;
  date: string;
  status: 'pending' | 'done' | 'skipped' | 'missed' | 'paused';
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
