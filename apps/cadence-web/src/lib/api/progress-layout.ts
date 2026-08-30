import type { ProgressLayout } from '@cadence/shared';
import { BASE, headers } from './http.ts';

/**
 * GET /me/progress-layout — the committed layout if the user (or, from Wave 3, the coach) has set
 * one; otherwise the deterministic default composed server-side from the user's goals. Never a
 * model call (docs/cadence/PROGRESS-ENGINE.md "The layout model").
 */
export async function getProgressLayout(): Promise<ProgressLayout> {
  const res = await fetch(`${BASE}/me/progress-layout`, { headers: headers() });
  if (!res.ok) throw new Error(`progress-layout failed: ${res.status}`);
  return res.json();
}

/* ── The progress talk's preview card (Wave 3, W3-2 client half) ─────────────────────────────
 * `compose_progress_view` writes a DRAFT layout server-side rather than the composition itself
 * landing in the chat wire — same reasoning as `open_week_review`'s pointer and
 * `propose_plan_change`'s stored proposal: the chat is pure SSE prose, so what the user agrees to
 * has to live somewhere a tool call actually reaches. LayoutProposalCard reads it back and the tap
 * is the consent; the page itself never changes until "Set my page this way" commits it. */

export interface ProgressLayoutDraft {
  draft_id: string;
  layout: ProgressLayout;
}

/**
 * The layout the coach proposed but nobody has committed yet. `null` covers every reason it might
 * not be there (never proposed, already committed, dismissed on another device, a server hiccup) —
 * same fallback shape as `getPendingChange`/`getPendingWeekReview`: the card has one honest
 * "nothing to show" answer for all of them, never a diagnosis.
 */
export async function getProgressLayoutDraft(): Promise<ProgressLayoutDraft | null> {
  const res = await fetch(`${BASE}/me/progress-layout/draft`, { headers: headers() });
  if (!res.ok) return null;
  const body = (await res.json()) as { draft: ProgressLayoutDraft | null };
  return body.draft;
}

/** "Set my page this way" — commits the draft, `draft → committed`. `false` on a 404 (unknown or
 *  stale draft, e.g. superseded by a newer proposal) as well as any other failure; the card's own
 *  "that didn't take" state covers both the same way ChangeCard's `apply` does. */
export async function commitProgressLayoutDraft(draftId: string): Promise<boolean> {
  const res = await fetch(`${BASE}/me/progress-layout/commit`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ draft_id: draftId }),
  });
  return res.ok;
}

/** "Not now" — drop the draft. The committed layout (or the deterministic default) is untouched,
 *  and she can propose again. */
export async function dismissProgressLayoutDraft(draftId: string): Promise<boolean> {
  const res = await fetch(`${BASE}/me/progress-layout/dismiss`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ draft_id: draftId }),
  });
  return res.ok;
}
