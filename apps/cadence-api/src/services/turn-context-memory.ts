import { createHash } from 'node:crypto';

/**
 * Telling the coach whether the data she was just handed is NEW to her.
 *
 * Just-in-time retrieval re-injects registry data on every turn it is relevant to, and that is
 * deliberate: it is what survives a long conversation, an idle gap and AI Admin's own session
 * compaction. We must NOT stop re-sending it — the whole point is that the dossier, not the
 * transcript, is what she remembers with.
 *
 * The bug was never the frequency. It was that every injection announced itself as
 * "Fetched for this turn", so identical content arriving three turns running looked like news
 * three times and she read the user's Apple Health history back three times, reworded slightly
 * each go — because she was re-summarising the same numbers, not recalling her own sentence.
 *
 * So: same data still goes in, framed as a reminder she already has. Changed data is flagged as
 * changed, which is the one case worth speaking up about. The framing is the fix.
 *
 * **The session transcript is the memory.** Each block carries a marker naming the function and
 * hashing its content, so the next turn can look back and tell new from unchanged from changed.
 * No new table, no in-process cache to be wrong after a redeploy or on a second instance — and it
 * degrades the right way: if history cannot be read, everything is treated as new, which is
 * exactly today's behaviour.
 */

/** Short content fingerprint — long enough to distinguish, short enough to read in a transcript. */
function fingerprint(rendered: string): string {
  return createHash('sha1').update(rendered.trim()).digest('hex').slice(0, 8);
}

/** The marker embedded in an injected block, e.g. `[ctx:get_health_history:9f2a1c04]`. */
export function ctxMarker(fn: string, rendered: string): string {
  return `[ctx:${fn}:${fingerprint(rendered)}]`;
}

export type ContextFreshness = 'new' | 'unchanged' | 'changed';

/**
 * Has this function's data been put in front of her before, and is it the same as last time?
 *
 * `history` is the concatenated text of the session's prior injected context turns.
 */
export function classifyFreshness(history: string, fn: string, rendered: string): ContextFreshness {
  if (!history.includes(`[ctx:${fn}:`)) return 'new';
  return history.includes(ctxMarker(fn, rendered)) ? 'unchanged' : 'changed';
}

const LEAD: Record<ContextFreshness, string> = {
  new: 'New to you this turn',
  // Stated flatly, because the failure mode is her being helpful about it.
  unchanged:
    'ALREADY YOURS, UNCHANGED — repeated only so it stays in view as the conversation grows. ' +
    'You have already seen this and may have already spoken about it. Do NOT summarise, restate ' +
    'or react to it again; simply use it',
  // Scoped tightly, because the failure mode is her re-presenting all N commitments for a
  // one-line edit: the block below is the WHOLE current state, but the news is only the delta.
  changed:
    'CHANGED since you last saw it — worth acknowledging briefly if it matters to the turn. ' +
    'Speak ONLY to what differs from the version you saw; the unchanged parts are repeated here ' +
    'for reference, not for comment — do NOT re-walk or restate them',
};

export interface RenderedPart {
  fn: string;
  rendered: string;
  freshness: ContextFreshness;
}

/** Group the turn's fetched data by how new it is, so each group gets one honest heading. */
export function renderContextBlock(parts: RenderedPart[], reason: string): string {
  const order: ContextFreshness[] = ['changed', 'new', 'unchanged'];
  const sections: string[] = [];
  for (const freshness of order) {
    const group = parts.filter((p) => p.freshness === freshness);
    if (!group.length) continue;
    const names = group.map((p) => p.fn).join(', ');
    const head = `${LEAD[freshness]} (${names})${freshness === 'new' && reason ? ` — ${reason}` : ''}:`;
    sections.push([head, ...group.map((p) => `${ctxMarker(p.fn, p.rendered)} ${p.rendered}`)].join('\n'));
  }
  return sections.join('\n\n');
}
