import type { SessionItem, SessionItemAlternative } from '@cadence/shared';
import { BASE, headers, timeoutSignal } from './http.ts';

/**
 * "Something else" on the Change sheet: ask the coach for one more move in an item's place
 * (routes/plan-alternative-item.ts). Answers inside the server's 25 s budget or says it could not
 * reach her; the sheet's row shows "Couldn't reach the coach — try again" and nothing waits on it.
 */
export type AlternativeItemOutcome =
  { ok: true; alternative: SessionItemAlternative } | { ok: false; reason: 'unreachable' | 'failed' };

export async function askAlternativeItem(ask: {
  activity?: string;
  item: Pick<SessionItem, 'name' | 'sets' | 'reps' | 'load' | 'duration_min' | 'distance_km' | 'detail'>;
  alreadyOffered?: string[];
}): Promise<AlternativeItemOutcome> {
  const res = await fetch(`${BASE}/plan/alternative-item`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ activity: ask.activity, item: ask.item, already_offered: ask.alreadyOffered ?? [] }),
    signal: timeoutSignal(30_000),
  }).catch(() => null);
  if (!res) return { ok: false, reason: 'unreachable' };
  const body = (await res.json().catch(() => null)) as { alternative?: SessionItemAlternative } | null;
  if (res.ok && body?.alternative?.name) return { ok: true, alternative: body.alternative };
  return { ok: false, reason: res.status === 503 ? 'unreachable' : 'failed' };
}
