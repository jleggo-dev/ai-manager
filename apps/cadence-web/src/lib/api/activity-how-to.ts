import { BASE, headers, timeoutSignal } from './http.ts';

/**
 * "Every time" on a Recap change (routes/plan-activity-how-to.ts): keep one plain sentence on the
 * session's commitment, so the coach writes every future session that way. `kept` is false when
 * the sentence was already there (the same sentence twice is one); `full` is the instruction at
 * its bound, with nothing written; `failed` is everything else, and the row says it didn't take.
 */
export type KeepHowToOutcome =
  { ok: true; kept: boolean; how_to: string; activity: string } | { ok: false; reason: 'full' | 'failed' };

export async function keepHowTo(occurrenceId: string, sentence: string): Promise<KeepHowToOutcome> {
  const res = await fetch(`${BASE}/plan/activity-how-to`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ occurrence_id: occurrenceId, sentence }),
    signal: timeoutSignal(15_000),
  }).catch(() => null);
  if (!res) return { ok: false, reason: 'failed' };
  const body = (await res.json().catch(() => null)) as {
    status?: string;
    how_to?: string;
    activity?: string;
    error?: string;
  } | null;
  if (res.ok && typeof body?.how_to === 'string') {
    return { ok: true, kept: body.status === 'written', how_to: body.how_to, activity: body.activity ?? '' };
  }
  return { ok: false, reason: res.status === 422 ? 'full' : 'failed' };
}
