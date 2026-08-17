import { useLayoutEffect, useRef } from 'react';

/**
 * Grow the composer's textarea to fit what's in it, up to the CSS max-height (~5 rows), then let
 * it scroll. Picks compose into the same field, so a multi-select answer grows it exactly as
 * typing would.
 *
 * A LAYOUT effect, and the ordering is load-bearing: the chat measures this whole stack in its own
 * layout effect to know how much room to reserve (useFloatingInset), and React runs a child's
 * layout effects BEFORE its parent's. As a plain useEffect this ran *after* that measurement, so
 * the chat reserved the height the composer had before it grew and the newest turn hid underneath.
 *
 * **A `scrollHeight` of 0 is refused, not written.** It means "this element has no layout box",
 * never "this element has no content" — a rendered textarea always reports at least its own
 * padding. Writing that 0 back is the bug the owner hit on device 2026-08-16: *"it's when I go to
 * the coach the first time when I open the application — after the first message the issue no
 * longer persists."* The app lands on the Plan tab, and the coach tab is kept MOUNTED behind
 * `display: none` (MainTabs) so an in-flight reply survives a tab switch. So the composer's very
 * first measurement is taken inside a hidden subtree, reads 0, and stamps `height: 0px` — and with
 * `box-sizing: border-box` that collapses the field to its 18px of padding, pinned to the bottom of
 * the 50px flex row by `align-items: flex-end`, with the caret clipped to a zero-height content
 * box. A tiny caret in the bottom-left corner of a box far taller than its content, exactly as
 * reported. Nothing re-measured it because the height only tracked the text, and the text had not
 * changed — the first keystroke was what finally fixed it.
 *
 * **No dependency array**, for the reason its neighbour useFloatingInset has none: every render is
 * a chance the field changed shape or finally got a box, and a layout effect catches all of them
 * before paint. Becoming visible is a MainTabs state change, so a render is guaranteed at exactly
 * the moment the refused measurement becomes takeable. ResizeObserver would be the tidier trigger
 * and is deliberately not used here — it was observed delivering no callbacks at all in one
 * embedded WebKit context (see useFloatingInset), which is the only context this bug lives in.
 */
export function useAutoGrow() {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    const prevHeight = ta.style.height;
    const prevOverflow = ta.style.overflowY;
    // Collapse before measuring so `scrollHeight` can only be the content. `auto` would let the
    // flex row stretch the field first, and the measurement would come back as the stretched box.
    ta.style.overflowY = 'hidden';
    ta.style.height = '0px';
    const content = ta.scrollHeight;
    if (content === 0) {
      // No box to measure. Put back exactly what was there and wait for a render that has one;
      // an unstamped field falls back to its `rows={1}` height, which is right for an empty one.
      ta.style.height = prevHeight;
      ta.style.overflowY = prevOverflow;
      return;
    }
    const max = parseFloat(getComputedStyle(ta).maxHeight) || Infinity;
    const overflowing = content > max;
    ta.style.height = `${overflowing ? max : content}px`;
    if (overflowing) ta.style.overflowY = 'auto';
  });

  return ref;
}
