/**
 * The coach's offer to lay a collection out — client for the two `/progress/repertoire/seed/offer`
 * routes (design frame 1e, P7).
 *
 * Its own module beside `repertoire-seed.ts` rather than more exports on that file: the seed's two
 * POSTs are the SCREEN's contract, and these two are the CHAT's — which offer is standing, and the
 * answer to it. Both doors end at the same confirm, and only that one writes anything.
 *
 * `offer_repertoire_review` stores a pointer server-side because the chat wire is pure SSE prose —
 * a tool call never reaches the browser — so this read is how the conversation learns an offer is
 * up. Same rail as `getPendingWeekReview`, same failure stance: a read that broke answers "no
 * offer" rather than throwing, because a missing card is not a broken conversation.
 */
import { BASE, headers } from './http.ts';

/** What the coach heard, and nothing about what the book holds — the review expands that itself. */
export interface RepertoireOffer {
  collection: string;
  /** The piece they said they were on, in their own words. Null when she heard no piece. */
  where_you_are: string | null;
  /** The goal she matched, or null. The review's own goal chips can still change it. */
  goal_id: string | null;
  offered_at: string;
}

/** The offer standing right now, or null when there is none (or the read failed). */
export async function getRepertoireOffer(): Promise<RepertoireOffer | null> {
  const res = await fetch(`${BASE}/progress/repertoire/seed/offer`, { headers: headers() }).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as { offer?: RepertoireOffer | null } | null;
  return body?.offer ?? null;
}

/**
 * Answer the offer — "Not now", or a finished review. Nothing else was stored by offering, so
 * there is nothing else to undo. Returns whether it actually cleared: a failure leaves it standing
 * server-side, and the next finished turn simply shows it again.
 */
export async function clearRepertoireOffer(): Promise<boolean> {
  const res = await fetch(`${BASE}/progress/repertoire/seed/offer/clear`, {
    method: 'POST',
    headers: headers(),
  }).catch(() => null);
  return !!res?.ok;
}
