import { BASE, headers } from './http.ts';

/**
 * The trail's hold menu on the wire: move a task to a day this week, copy it onto one, take it
 * off the plan. Mirrors routes/plan-occurrence-edit.ts — the server holds the week-window rule
 * and the one-per-day rule; this only names what it answered.
 */
export type OccurrenceEditOutcome =
  | { ok: true; occurrence_id: string }
  /** The same task already sits on that day — `existing_occurrence_id` is the row to open instead. */
  | { ok: false; reason: 'already_there'; existing_occurrence_id: string; existing_status: string }
  /** `out_of_range`: the day is not in this week (the phone's week was stale). `gone`: the row
   *  vanished under a replan. `failed`: the network, or the server, said nothing usable. */
  | { ok: false; reason: 'out_of_range' | 'gone' | 'failed' };

async function dated(path: string, date: string): Promise<OccurrenceEditOutcome> {
  const res = await fetch(path, { method: 'POST', headers: headers(), body: JSON.stringify({ date }) }).catch(
    () => null,
  );
  if (!res) return { ok: false, reason: 'failed' };
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.ok) return { ok: true, occurrence_id: String(body?.occurrence_id ?? '') };
  if (res.status === 409 && typeof body?.existing_occurrence_id === 'string') {
    return {
      ok: false,
      reason: 'already_there',
      existing_occurrence_id: body.existing_occurrence_id,
      existing_status: String(body.existing_status ?? 'pending'),
    };
  }
  if (res.status === 422) return { ok: false, reason: 'out_of_range' };
  if (res.status === 404) return { ok: false, reason: 'gone' };
  return { ok: false, reason: 'failed' };
}

/** Re-date the task. Its id survives the move, so the sheet that opens afterwards is the same one. */
export const moveOccurrence = (id: string, date: string): Promise<OccurrenceEditOutcome> =>
  dated(`${BASE}/plan/occurrences/${id}/move`, date);

/** A fresh, still-to-do copy of the task on `date`; the id answered is the copy's. */
export const duplicateOccurrence = (id: string, date: string): Promise<OccurrenceEditOutcome> =>
  dated(`${BASE}/plan/occurrences/${id}/duplicate`, date);

export async function deleteOccurrence(id: string): Promise<{ ok: boolean; reason?: 'gone' | 'failed' }> {
  const res = await fetch(`${BASE}/plan/occurrences/${id}`, { method: 'DELETE', headers: headers() }).catch(() => null);
  if (!res) return { ok: false, reason: 'failed' };
  if (res.ok) return { ok: true };
  return { ok: false, reason: res.status === 404 ? 'gone' : 'failed' };
}
