import { useLayoutEffect, useRef } from 'react';
import { scrollPane } from './useLandOnNow.ts';

/**
 * Keep what the person is looking at where it is when days are added ABOVE it.
 *
 * Scrolling the trail back loads last week on top of today. Without this, the browser keeps
 * `scrollTop` and the whole screen lurches down by a week's height — the day they were on is
 * gone and last Monday is in its place, which reads as the trail jumping. Measuring the pane
 * before and after the prepend and moving `scrollTop` by the difference keeps the same node
 * under their thumb; the new days are above, where they asked for them, one flick up.
 *
 * `prependedCount` is how many days sit above the original first day. The pane's height is
 * remembered after EVERY render, so the difference on the render where the count grows is the
 * height those days added — whatever else moved that render moves with them, which is the
 * honest thing to do. Scrolls the pane, never `scrollIntoView` (the useLandOnNow rule).
 */
export function useKeepScrollOnPrepend(prependedCount: number) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<{ count: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pane = scrollPane(el);
    if (!pane) return;
    const prev = last.current;
    if (prev && prependedCount > prev.count) {
      pane.scrollTop += pane.scrollHeight - prev.height;
    }
    last.current = { count: prependedCount, height: pane.scrollHeight };
  });

  return ref;
}
