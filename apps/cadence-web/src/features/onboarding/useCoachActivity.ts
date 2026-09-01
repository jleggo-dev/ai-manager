import { useCallback, useState } from 'react';
import { coachActivityLine } from '@cadence/shared';

/**
 * What she is doing right now, in words.
 *
 * Owner, 2026-08-16: *"when I use products in a harness like Claude, they usually tell me when
 * they're calling a tool. This would help us diagnose and it would also tell the user something is
 * happening (or happened)."* Every failure this week was invisible work — she said a session was
 * logged and none was, said a constraint was removed and it was not. A screen that says "writing
 * that down…" and then goes quiet is a question the user can ask. No line at all is not.
 *
 * Its own hook rather than three more lines in `useCoachChat`, which was already at the 150-line
 * ceiling — and the split is honest rather than cosmetic: "say what she is doing" is a distinct
 * responsibility from "run the conversation", and it is the piece a future surface (the plan
 * sheet, the weekly check-in) would want to reuse without inheriting a chat.
 *
 * `clear` is not optional politeness. A stale "writing that down…" outliving its turn is the same
 * false claim this exists to prevent, so the turn's every ending path calls it.
 */

/**
 * The turn's opening stage, from the server's `stage` frame — sent once per turn, right after the
 * stream opens and BEFORE any model work. Same voice as the tool phrases (lowercase participle, no
 * pronoun) because it renders in exactly the same slot. Only stages the server actually reports
 * get a line; an unknown name shows nothing rather than something false.
 */
const STAGE_LINES: Record<string, string> = {
  reading: 'reading your file',
};

export function useCoachActivity() {
  const [activity, setActivity] = useState('');

  /** Names arrive from the server's `cadence` SSE frame; the phrasing is shared (BRAND: behaviour, never the entity). */
  const noteActivity = useCallback((names: string[]) => setActivity(coachActivityLine(names)), []);
  /** The pre-first-token stretch gets words too — "reading your file" while she is, instead of bare dots. */
  const noteStage = useCallback((name: string) => {
    const line = STAGE_LINES[name];
    if (line) setActivity(line);
  }, []);
  const clearActivity = useCallback(() => setActivity(''), []);

  return { activity, noteActivity, noteStage, clearActivity };
}
