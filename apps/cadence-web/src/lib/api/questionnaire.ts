/**
 * The questions the coach put on this screen — client for the two `/coach/questionnaire` routes.
 *
 * Its own module beside `repertoire-offer.ts` and for the same reason: this is the CHAT's
 * contract — which card is standing, and the answer to it — and it is two calls, not a feature's
 * worth of endpoints.
 *
 * `send_questionnaire` stores the questions server-side because the chat wire is pure SSE prose —
 * a tool call never reaches the browser — so this read is how the conversation learns a card is
 * up. Same failure stance as the offer read: a read that broke answers "nothing up" rather than
 * throwing, because a missing card is not a broken conversation.
 *
 * There is no `submit` here on purpose. The answers go out through the ordinary send path, in the
 * person's own bubble, so what the coach receives is what they can see they said.
 */
import type { PendingQuestionnaire } from '@cadence/shared';
import { BASE, headers } from './http.ts';

/** The card standing right now, or null when there is none (or the read failed). */
export async function getQuestionnaire(): Promise<PendingQuestionnaire | null> {
  const res = await fetch(`${BASE}/coach/questionnaire`, { headers: headers() }).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as { questionnaire?: PendingQuestionnaire | null } | null;
  const pending = body?.questionnaire ?? null;
  // A card with no questions is not a card. Guarding the shape here rather than in the component
  // keeps a malformed row from taking the whole Coach tab down over one bad write.
  return pending?.questions?.length ? pending : null;
}

/**
 * Answer the card — sent, or put aside. Nothing else was stored by asking, so there is nothing
 * else to undo. Returns whether it actually cleared: a failure leaves it standing server-side, and
 * the next finished turn simply shows it again.
 */
export async function clearQuestionnaire(): Promise<boolean> {
  const res = await fetch(`${BASE}/coach/questionnaire/clear`, { method: 'POST', headers: headers() }).catch(
    () => null,
  );
  return !!res?.ok;
}
