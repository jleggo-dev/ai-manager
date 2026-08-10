import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * How much room the floating composer stack is actually taking, so the chat can reserve exactly
 * that much and no turn ever hides behind it.
 *
 * It used to be a flat `padding-bottom: 122px` in the stylesheet, chosen when the stack was one
 * text field and a disclaimer line. It has since grown the Broker's capture pills and the
 * confirmation's two-button bar, and it changes height *while you use it* — the composer grows to
 * five rows, pills appear as goals are heard. Every pixel past 122 was a pixel of conversation
 * underneath an opaque control.
 *
 * That produced two bugs that read as unrelated and were not: the capture pills covering the
 * options you were trying to tap, and "Cadence is replying…" with the typing dots parked below the
 * fold — scrolling to `scrollHeight` lands you at the bottom of the CONTENT, which was still
 * behind the stack, so it looked like nothing was happening.
 *
 * Measured rather than guessed, because the next thing added to that stack would break it again.
 *
 * **Measured on every render, not only via ResizeObserver.** Every growth in this stack is caused
 * by a React render — pills arriving, the composer growing a row, the confirm bar replacing the
 * composer — so a layout effect catches all of them, and catches them before paint. ResizeObserver
 * stays as well, for the changes no render explains (the iOS keyboard, a font settling), but it is
 * the belt and not the braces: it was observed delivering no callbacks at all in one embedded
 * WebKit context, including the initial one it is specified to send. Depending on it alone would
 * have shipped a layout that silently never updates.
 */

/** Falls back to the old constant if ResizeObserver is unavailable (older jsdom, ancient Safari). */
const FALLBACK_PX = 122;

/** A little air so the last turn clears the scrim rather than touching it. */
const BREATHING_ROOM_PX = 14;

export function useFloatingInset(): { inset: number; floatRef: (el: HTMLElement | null) => void } {
  const [height, setHeight] = useState(FALLBACK_PX);
  const el = useRef<HTMLElement | null>(null);
  const observer = useRef<ResizeObserver | null>(null);

  // A zero height is the element mid-teardown, not a stack that vanished — keeping the last known
  // value avoids the chat lurching downward for a frame on every swap.
  const measure = useCallback(() => {
    const h = el.current?.offsetHeight ?? 0;
    if (h > 0) setHeight((prev) => (prev === h ? prev : h));
  }, []);

  // No dependency array: every render is a chance the stack changed shape, and this is one
  // offsetHeight read. `setHeight` no-ops on an unchanged value, so it cannot loop.
  useLayoutEffect(measure);

  useEffect(() => () => observer.current?.disconnect(), []);

  const floatRef = useCallback(
    (node: HTMLElement | null) => {
      observer.current?.disconnect();
      observer.current = null;
      el.current = node;
      if (!node) return;
      measure();
      if (typeof ResizeObserver === 'undefined') return;
      observer.current = new ResizeObserver(measure);
      observer.current.observe(node);
    },
    [measure],
  );

  return { inset: Math.round(height) + BREATHING_ROOM_PX, floatRef };
}
