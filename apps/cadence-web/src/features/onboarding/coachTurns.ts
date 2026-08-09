import { parseCoachTurn, type CoachPicks } from '@cadence/shared';
import type { CoachTurn } from './useCoachChat.ts';

/**
 * Reading a coach turn: prose out, picks out, in that order.
 *
 * Kept out of `useCoachChat` on purpose. The hook owns the network — restore, send, SSE-drop
 * recovery — and none of that should have to be re-tested to change how a pick block is read.
 * Everything here is pure, so the interesting cases (a block still streaming, picks on an old
 * question, no picks at all) are unit tests rather than a mounted chat.
 */

export interface CoachTurnView {
  role: 'user' | 'coach';
  /** The turn as it should be rendered — the pick block already removed. */
  text: string;
  /** Picks carried by this turn, whether or not they are still live. */
  picks: CoachPicks | null;
}

export function viewTurns(turns: readonly CoachTurn[]): CoachTurnView[] {
  return turns.map((t) =>
    t.role === 'coach' ? { role: 'coach', ...parseCoachTurn(t.text) } : { role: 'user', text: t.text, picks: null },
  );
}

/**
 * The one pick set that is still answerable: the newest coach turn's, and only once the stream
 * has finished.
 *
 * Older questions keep their picks in the transcript data but never render them — a tappable
 * answer to a question three turns back is an invitation to answer something the coach has
 * already moved past, and the composed message would land with no context. Scrolling back should
 * read as a record of what was said, not a set of live controls.
 */
export function livePicks(views: readonly CoachTurnView[], streaming: boolean): CoachPicks | null {
  if (streaming) return null;
  const last = views[views.length - 1];
  return last?.role === 'coach' ? last.picks : null;
}

/**
 * How far through the conversation the coach thinks it is, 0–1.
 *
 * The coach's own read, not a step counter — there is no fixed number of questions, so a client
 * -side "step 3 of 5" would be a lie the moment Cadence skips one. The last number it gave stands
 * until it gives another, which is why a turn without picks never drops the bar back to zero.
 */
export function chatProgress(views: readonly CoachTurnView[]): number {
  for (let i = views.length - 1; i >= 0; i--) {
    const p = views[i]?.picks?.progress;
    if (typeof p === 'number') return p;
  }
  return 0;
}
