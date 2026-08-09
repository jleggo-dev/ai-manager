import type { CSSProperties } from 'react';
import { TONE } from './tone.ts';

/**
 * The interval player's styles, split out of `StepInterval.tsx` so the component file stays about
 * behaviour. Extracted at ~478 of the 500-line cap rather than after breaking it — a 200-line
 * block of `CSSProperties` is the least interesting part of that file and the easiest to lift.
 *
 * Two values are load-bearing rather than decorative and are commented where they sit: the 56px
 * numeral (the biggest in the app — this is the phone-on-the-floor screen) and `nextLine`'s
 * maxWidth (the ring's inner clearance).
 */

/** The ring's diameter in CSS pixels. Also the tap target, which is the point. */
export const RING_PX = 232;

export const badge: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  color: 'white',
  borderRadius: 999,
  padding: '5px 12px',
  transition: 'background 0.7s ease',
};
export const coachChip: CSSProperties = {
  background: 'oklch(100% 0 0 / 0.7)',
  border: '1px solid oklch(86% 0.04 66)',
  borderRadius: 12,
  padding: '7px 11px',
  display: 'flex',
  alignItems: 'baseline',
  gap: 6,
};
export const coachLabel: CSSProperties = {
  fontSize: 9.5,
  fontWeight: 900,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'oklch(55% 0.04 62)',
};
export const editLink: CSSProperties = {
  border: 'none',
  background: 'transparent',
  padding: 0,
  fontSize: 11,
  fontWeight: 900,
  color: 'oklch(45% 0.09 152)',
  cursor: 'pointer',
};
export const card: CSSProperties = {
  background: 'white',
  border: '1px solid oklch(91% 0.015 85)',
  borderRadius: 18,
  padding: 16,
  boxShadow: '0 1px 3px oklch(0% 0 0 / 0.04)',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};
export const stage: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  position: 'relative',
  height: RING_PX,
};
export const eyebrow: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 900,
  letterSpacing: '0.09em',
  textTransform: 'uppercase',
  transition: 'color 0.7s ease',
};
export const roundLine: CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: TONE.sub,
};
/** The biggest numeral in the app — this is the phone-on-the-floor screen. */
export const numeral: CSSProperties = {
  fontFamily: 'var(--display), serif',
  fontWeight: 600,
  fontSize: 56,
  lineHeight: 1,
  color: TONE.ink,
  fontVariantNumeric: 'tabular-nums',
};
export const nextLine: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 800,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: TONE.sub,
  textAlign: 'center',
  // The ring's inner clearance at r=54 / stroke 12. Anything longer wraps inside the ring rather
  // than running out across the wedges.
  maxWidth: 156,
  lineHeight: 1.25,
};
export const metric: CSSProperties = {
  fontSize: 15,
  fontWeight: 900,
  color: 'oklch(32% 0.02 150)',
  fontVariantNumeric: 'tabular-nums',
};
export const metricCaps: CSSProperties = {
  fontSize: 9.5,
  fontWeight: 900,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: TONE.sub,
};
export const primaryBtn: CSSProperties = {
  border: 'none',
  borderRadius: 16,
  padding: 15,
  fontSize: 15,
  fontWeight: 900,
  color: 'white',
  cursor: 'pointer',
  background: `linear-gradient(180deg, ${TONE.fillA} 0%, ${TONE.fillB} 46%)`,
  boxShadow: `0 5px 0 ${TONE.deep}`,
};
export const greyBtn: CSSProperties = {
  border: 'none',
  borderRadius: 16,
  padding: 15,
  fontSize: 15,
  fontWeight: 900,
  color: 'oklch(42% 0.02 150)',
  cursor: 'pointer',
  background: 'linear-gradient(180deg, oklch(96% 0.008 85) 0%, oklch(93% 0.01 85) 46%)',
  boxShadow: '0 5px 0 oklch(87% 0.015 85)',
};
export const secBtn: CSSProperties = {
  flex: 1,
  textAlign: 'center',
  background: 'white',
  border: '1.5px solid oklch(90% 0.015 95)',
  borderRadius: 12,
  padding: '10px 0',
  fontSize: 12,
  fontWeight: 900,
  color: 'oklch(40% 0.02 150)',
  cursor: 'pointer',
};
export const chimeOnStyle: CSSProperties = {
  background: 'oklch(97% 0.02 74)',
  border: '1.5px solid oklch(86% 0.04 66)',
  color: TONE.chipInk,
};
