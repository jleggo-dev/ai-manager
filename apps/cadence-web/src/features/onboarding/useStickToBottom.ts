import { useCallback, useEffect, useRef, type RefObject } from 'react';

/**
 * Keep a chat pinned to the newest turn — but only while the reader is actually down there.
 *
 * The naive version (`scrollTop = scrollHeight` in an effect keyed on the turns) is what shipped,
 * and it made the onboarding chat feel broken on a phone. Streaming mutates the turn array on
 * every SSE delta, so the effect refires dozens of times a second while Cadence is talking, and
 * each run drags the reader back down. Trying to scroll up mid-reply is not "hard", it is
 * impossible — the fix is not a smoother animation, it is not scrolling at all.
 *
 * So: follow the bottom only when they are already at the bottom. The moment they scroll up to
 * re-read something, they own the viewport until they come back down. `stickNow` re-arms it for
 * the one case where jumping IS what they want — they just sent a message, so the newest turn is
 * the thing they are waiting for.
 */

/** How close to the bottom still counts as "reading the newest turn" (px). */
const STICK_THRESHOLD_PX = 80;

export function useStickToBottom<T>(ref: RefObject<HTMLElement | null>, dep: T) {
  const sticking = useRef(true);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    sticking.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
  }, [ref]);

  /** Force-follow again — for when the user's own action means they want the newest turn. */
  const stickNow = useCallback(() => {
    sticking.current = true;
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || !sticking.current) return;
    el.scrollTop = el.scrollHeight;
  }, [ref, dep]);

  return { onScroll, stickNow };
}
