import { useLayoutEffect, useRef } from 'react';
import type { PlanOccurrence } from '../../lib/api.ts';

/**
 * Clearance above the node we land on, when the trail has not told us how much to leave.
 *
 * The header floats OVER the trail now, so there is no static band above the scroll to push the
 * node clear of it — landing at the node's exact top would park it under the chrome. The real
 * number lives in CSS (`--trail-lead` on `.trail`), where whoever owns the header's height can
 * retune it in one place; this is the fallback for when the stylesheet has not loaded (tests).
 */
const LEAD_FALLBACK_PX = 72;

/**
 * The node you are on: the first thing today you have not settled yet, and the last one once the
 * whole day is behind you. Done and skipped both count as settled — the ring counts what happened,
 * but landing only cares whether the day still wants something from you.
 */
export function currentNodeIndex(occurrences: PlanOccurrence[]): number {
  const next = occurrences.findIndex((o) => o.status !== 'done' && o.status !== 'skipped');
  return next === -1 ? occurrences.length - 1 : next;
}

/** The nearest ancestor that actually scrolls. Null when nothing does (jsdom, or a short day). */
function scrollPane(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/**
 * Open the trail on the current node, with the kept part of the day above it.
 *
 * Since the floating START pill went, this IS the "what's next" signal: you arrive looking at the
 * thing you are on, and the morning you already kept is behind you rather than in your way. It
 * fires **once per mount** — a refetch must never yank the viewport out from under someone reading
 * back through their day (the lesson `useStickToBottom` exists to enforce).
 *
 * Scrolls the pane, never `scrollIntoView`: that pans the whole shell on mobile.
 */
export function useLandOnNow() {
  const ref = useRef<HTMLButtonElement>(null);
  const landed = useRef(false);

  useLayoutEffect(() => {
    const node = ref.current;
    if (landed.current || !node) return;
    const pane = scrollPane(node);
    if (!pane) return;
    landed.current = true;

    const declared = Number.parseFloat(getComputedStyle(node).getPropertyValue('--trail-lead'));
    const lead = Number.isFinite(declared) ? declared : LEAD_FALLBACK_PX;
    const offset = node.getBoundingClientRect().top - pane.getBoundingClientRect().top;
    pane.scrollTop = Math.max(0, pane.scrollTop + offset - lead);
  });

  return ref;
}
