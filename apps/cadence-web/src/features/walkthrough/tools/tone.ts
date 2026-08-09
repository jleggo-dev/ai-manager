/**
 * The walkthrough's "do" tone — the single colour that means "this records something" (design 1A).
 * The v2 handoff commits to one warm amber for every tool so the coloured button is always the log.
 * (Task-tone theming per time-of-day is a later refinement; the design's screens are all this tone.)
 */
export const TONE = {
  deep: 'oklch(63% 0.15 68)',
  fillA: 'oklch(79% 0.16 70)',
  fillB: 'oklch(71% 0.16 68)',
  track: 'oklch(94% 0.02 74)',
  tint: 'oklch(95% 0.035 74)',
  chipInk: 'oklch(48% 0.11 60)',
  ink: 'oklch(28% 0.02 150)',
  ink2: 'oklch(25% 0.02 150)',
  sub: 'oklch(58% 0.02 120)',
  off: 'oklch(52% 0.12 40)', // off-target — a colour change, never a warning
  green: 'oklch(52% 0.09 152)',
  greenEdge: 'oklch(39% 0.08 152)',
};

export const RING_C = 339.29; // circumference at r=54 (2π·54), the shared ring geometry

/**
 * The interval player's per-phase palette. Colour is the INSTRUCTION here, not decoration: from
 * three metres away, on a phone on the floor, amber means push, green means breathe and grey means
 * neither — the numbers are confirmation, not the signal. So each kind carries its whole set:
 *
 *   tint  — the frame background (recover is deliberately calmer, chroma 0.025 vs work's 0.035;
 *           the loud state is the one where you're working)
 *   done  — a finished ring wedge      fill — the current wedge, filling pro-rata
 *   track — an upcoming wedge, kind-tinted so the pattern AHEAD is readable before you start
 *   deep  — the phase word above the countdown       badge — the tool chip
 *   headInk / headSub — the walkthrough header's title and captions, which recolour with the
 *           frame: a green frame with amber captions reads as a rendering bug, not a state
 *
 * What is NOT here on purpose: a per-kind button colour. The primary stays the amber do-tone in
 * every phase — colour-code the state, never the controls, or the pause button that was amber
 * three seconds ago turns green and pretends to be a different button.
 */
export const INTERVAL_KIND = {
  work: {
    tint: 'oklch(95% 0.035 74)',
    done: 'oklch(63% 0.15 68)',
    fill: 'oklch(79% 0.16 70)',
    track: 'oklch(94% 0.02 74)',
    deep: 'oklch(50% 0.12 62)',
    badge: 'oklch(63% 0.15 68)',
    headInk: 'oklch(38% 0.05 60)',
    headSub: 'oklch(52% 0.04 62)',
  },
  recover: {
    tint: 'oklch(95.5% 0.025 152)',
    done: 'oklch(52% 0.09 152)',
    fill: 'oklch(66% 0.11 152)',
    track: 'oklch(94% 0.02 152)',
    deep: 'oklch(45% 0.08 152)',
    badge: 'oklch(52% 0.09 152)',
    headInk: 'oklch(35% 0.05 152)',
    headSub: 'oklch(48% 0.05 152)',
  },
  neutral: {
    tint: 'oklch(96.5% 0.008 85)',
    done: 'oklch(72% 0.012 85)',
    fill: 'oklch(78% 0.008 250)',
    track: 'oklch(94.5% 0.008 85)',
    deep: 'oklch(50% 0.02 120)',
    badge: 'oklch(55% 0.02 120)',
    headInk: 'oklch(38% 0.02 150)',
    headSub: 'oklch(52% 0.02 120)',
  },
} as const;
