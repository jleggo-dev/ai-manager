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
