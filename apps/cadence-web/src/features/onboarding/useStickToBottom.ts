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
 *
 * **Why a touch handler and not just `onScroll`.** The first version of this detached only when a
 * scroll event said they had moved away from the bottom, and it still felt impossible to scroll on
 * a phone mid-reply. Scroll events are passive and coalesced; the streaming effect runs
 * synchronously on every SSE delta, many times a second. The finger drags, the next delta snaps
 * the view back, and the scroll event that would have detached us arrives too late to matter — the
 * user loses the race with the network. A finger going down IS the intent, so it detaches
 * immediately and nothing auto-scrolls until it lifts. On release we look at where they actually
 * are: still at the bottom means keep following; scrolled up means the viewport is theirs.
 */

/** How close to the bottom still counts as "reading the newest turn" (px). */
const STICK_THRESHOLD_PX = 80;

export function useStickToBottom<T>(ref: RefObject<HTMLElement | null>, dep: T) {
  const sticking = useRef(true);
  const touching = useRef(false);

  /** Are they looking at the newest turn, or reading something further up? */
  const atBottom = useCallback(() => {
    const el = ref.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
  }, [ref]);

  const onScroll = useCallback(() => {
    // Ignored while a finger is down: mid-drag the position is theirs to decide, and reading it
    // here would let a momentary overshoot back to the bottom re-arm the follow under them.
    if (!touching.current) sticking.current = atBottom();
  }, [atBottom]);

  /** A finger on the transcript means they want to move it — stop following before the next delta. */
  const onTouchStart = useCallback(() => {
    touching.current = true;
  }, []);

  /** Momentum may still be running; where they ended up is what decides whether we resume. */
  const onTouchEnd = useCallback(() => {
    touching.current = false;
    sticking.current = atBottom();
  }, [atBottom]);

  /** Force-follow again — for when the user's own action means they want the newest turn. */
  const stickNow = useCallback(() => {
    touching.current = false;
    sticking.current = true;
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || touching.current || !sticking.current) return;
    el.scrollTop = el.scrollHeight;
  }, [ref, dep]);

  return { onScroll, onTouchStart, onTouchEnd, stickNow };
}
