/**
 * Two-tone nutrition ring math (food-module redesign). One target, two stacked arcs:
 *   • logged — what's already on today's totals (solid)
 *   • pending — what THIS meal would add (pale), drawn starting where logged ends
 * so its leading edge reads as a hard tick "this is the new bit". The grey remainder is
 * what's still free. Lengths are expressed against `pathLength=100` so the SVG stays
 * size-independent (the ring renders 52–118px with the same numbers).
 *
 * Over-target is a fact, never a warning: the pending arc just turns warm and the centre
 * reads "N over" — no red, no ✗ (BRAND.md — observe, don't scold).
 */
export interface RingArcs {
  /** Arc length (0–100) for the already-logged portion, clamped to the ring. */
  loggedLen: number;
  /** Arc length (0–100) for this meal's addition, clamped so logged+pending never wrap past the ring. */
  pendingLen: number;
  /** Where the pending arc starts (= loggedLen) — its butt cap becomes the "new bit" tick. */
  pendingOffset: number;
  /** logged + pending exceeds the target — colour the pending arc warm, read the centre as "over". */
  over: boolean;
  /** target − logged − pending; negative once over (centre shows its magnitude). */
  remaining: number;
}

/** Resolve the three arcs for a ring. `target` must be > 0 (callers guard the no-target case). */
export function ringArcs(logged: number, pending: number, target: number): RingArcs {
  const t = target > 0 ? target : 1;
  const loggedLen = clampPct((logged / t) * 100);
  const rawPending = Math.max(0, (pending / t) * 100);
  // The pending arc can only fill what the logged arc left free, so the two never overlap or wrap.
  const pendingLen = Math.max(0, Math.min(rawPending, 100 - loggedLen));
  return {
    loggedLen,
    pendingLen,
    pendingOffset: loggedLen,
    over: logged + pending > target + 1e-9,
    remaining: target - logged - pending,
  };
}

function clampPct(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 100 ? 100 : n;
}
