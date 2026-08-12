import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';

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

/**
 * How long after a finger leaves the transcript we refuse to auto-scroll, whatever else we think.
 *
 * The touch handlers alone were not enough, and the reason is momentum. A flick upward is over as a
 * TOUCH almost immediately — the finger lifts within a few dozen milliseconds, while the content is
 * still travelling. At that instant the transcript is usually still near the bottom, so re-reading
 * the position on touchend re-armed the follow, and the next SSE delta (milliseconds later, mid
 * reply) slammed it back down. The momentum scroll events that would have detached us arrive after
 * that, far too late. So the finger lifting is not permission to resume: the transcript has to come
 * to rest first, and this window is how long we wait before believing where it landed.
 */
const HANDS_OFF_MS = 900;

export function useStickToBottom(ref: RefObject<HTMLElement | null>) {
  const sticking = useRef(true);
  const touching = useRef(false);
  /** When a MOVING touch last ended. 0 means nothing is holding the follow off — see `stickNow`. */
  const lastTouchAt = useRef(0);
  /** Where the transcript sat when the finger went down, and whether it has moved since. */
  const touchStartTop = useRef(0);
  const moved = useRef(false);

  /** Are they looking at the newest turn, or reading something further up? */
  const atBottom = useCallback(() => {
    const el = ref.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
  }, [ref]);

  const onScroll = useCallback(() => {
    // While a finger is down we only note THAT it moved, never where to: mid-drag the position is
    // theirs to decide, and reading it here would let a momentary overshoot back to the bottom
    // re-arm the follow under them.
    if (touching.current) {
      if (ref.current && ref.current.scrollTop !== touchStartTop.current) moved.current = true;
      return;
    }
    sticking.current = atBottom();
  }, [atBottom, ref]);

  /** A finger on the transcript means they want to move it — stop following before the next delta. */
  const onTouchStart = useCallback(() => {
    touching.current = true;
    moved.current = false;
    touchStartTop.current = ref.current?.scrollTop ?? 0;
  }, [ref]);

  /**
   * What happens on release depends on whether the transcript MOVED, and the distinction is the
   * whole fix.
   *
   * A touch that moved nothing is a tap — dismissing the keyboard, catching a stray press. Where
   * they are is where they meant to be, so read it and carry on following if they are at the bottom.
   *
   * A touch that moved is a drag or a flick, and momentum means it is not finished. A flick upward
   * is over as a TOUCH within a few dozen milliseconds while the content is still travelling, so at
   * that instant the transcript is usually STILL near the bottom — reading the position here is
   * exactly what re-armed the follow and let the next SSE delta slam it back down. So we do not
   * read it: `onScroll` fires throughout the glide and re-arms only if they come to rest at the
   * bottom, and until then the hands-off window keeps deltas from touching the viewport.
   */
  const onTouchEnd = useCallback(() => {
    touching.current = false;
    if (moved.current) lastTouchAt.current = Date.now();
    else sticking.current = atBottom();
  }, [atBottom]);

  /** Force-follow again — for when the user's own action means they want the newest turn. */
  const stickNow = useCallback(() => {
    touching.current = false;
    sticking.current = true;
    // Clears the hands-off window too: this is the user asking to be taken to the newest turn
    // (they just sent something), which outranks having touched the transcript a moment ago.
    lastTouchAt.current = 0;
  }, []);

  /**
   * Follow on EVERY render, not on a turns dependency — and that is the fix for the second half of
   * "I can't get to the options".
   *
   * Keyed on the turn array, this only ran when a turn changed. But the two things that grow the
   * transcript last both happen on renders where the turns are already final. Quick picks are
   * withheld until the stream ENDS (`livePicks` returns null while streaming), so they mount on a
   * `streaming` flip. The Broker's capture pills land ~900ms later still, on a state change of
   * their own, and they make the floating stack taller — which grows the chat's reserved padding
   * underneath them. Both grew the content below a scroll position that had stopped being the
   * bottom, so the last thing you were shown was a half-visible row of tiles with the rest of the
   * grid parked behind the pills, and no reason to think there was more.
   *
   * A LAYOUT effect so the correction happens before paint rather than as a visible jump. Cheap
   * enough to run unconditionally: one property read and one write, and the write is a no-op when
   * we are already at the bottom. Every guard above still holds — a finger down, a scroll away, or
   * the hands-off window all return before we touch the viewport, so this cannot resurrect the
   * can't-scroll-while-she-replies bug the rest of this file exists to prevent.
   */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || touching.current || !sticking.current) return;
    if (Date.now() - lastTouchAt.current < HANDS_OFF_MS) return;
    el.scrollTop = el.scrollHeight;
  });

  return { onScroll, onTouchStart, onTouchEnd, stickNow };
}
