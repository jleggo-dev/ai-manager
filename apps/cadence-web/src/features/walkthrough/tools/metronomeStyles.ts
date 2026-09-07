import type { CSSProperties } from 'react';
import { TONE } from './tone.ts';

/**
 * The metronome dock's styles, split out of `Metronome.tsx` on the same principle as
 * `intervalStyles.ts` — the component file stays about behaviour.
 *
 * The dock is deliberately quieter than every tool card it sits under. It is an accessory to the
 * step, not the step: a bordered strip rather than a white card, no drop-shadowed primary, and the
 * amber do-tone appears only on the running Stop button. A pulse that out-shouted the timer it
 * accompanies would be the tail wagging the dog.
 */

export const dock: CSSProperties = {
  border: '1px solid oklch(91% 0.015 85)',
  borderRadius: 16,
  background: 'oklch(98.5% 0.006 85)',
  overflow: 'hidden',
};

/** The collapsed pill — a full-width tap target, because it is the only way in. */
export const pill: CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  background: 'transparent',
  border: 'none',
  padding: '11px 14px',
  cursor: 'pointer',
  textAlign: 'left',
  font: 'inherit',
};

export const pillNote: CSSProperties = {
  fontFamily: 'var(--display), serif',
  fontSize: 17,
  fontWeight: 600,
  color: TONE.deep,
  lineHeight: 1,
};

export const pillBpm: CSSProperties = {
  fontSize: 13.5,
  fontWeight: 900,
  color: 'oklch(35% 0.02 150)',
  fontVariantNumeric: 'tabular-nums',
};

export const pillHint: CSSProperties = {
  marginLeft: 'auto',
  fontSize: 10.5,
  fontWeight: 900,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: TONE.sub,
};

export const body: CSSProperties = {
  padding: '4px 14px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

/** The tempo, in the app's display face — the one number you read from the bench. */
export const bpmNumber: CSSProperties = {
  fontFamily: 'var(--display), serif',
  fontWeight: 600,
  fontSize: 40,
  lineHeight: 1,
  color: TONE.ink,
  fontVariantNumeric: 'tabular-nums',
};

export const marking: CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  fontStyle: 'italic',
  color: TONE.sub,
  marginTop: 3,
};

export const stepper: CSSProperties = {
  width: 40,
  height: 40,
  flex: 'none',
  borderRadius: 12,
  border: '1.5px solid oklch(90% 0.015 95)',
  background: 'white',
  fontSize: 19,
  fontWeight: 900,
  color: 'oklch(40% 0.02 150)',
  cursor: 'pointer',
  lineHeight: 1,
};

export const slider: CSSProperties = {
  flex: 1,
  accentColor: TONE.fillB,
  cursor: 'pointer',
  minWidth: 0,
};

export const dotRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  minHeight: 16,
};

/** One beat. The downbeat is a ring rather than a dot so the bar has a visible top even at rest. */
export function dot(active: boolean, down: boolean): CSSProperties {
  return {
    width: down ? 13 : 10,
    height: down ? 13 : 10,
    borderRadius: 999,
    flex: 'none',
    background: active ? (down ? TONE.deep : TONE.fillA) : 'oklch(91% 0.012 85)',
    border: down ? `2px solid ${active ? TONE.deep : 'oklch(84% 0.02 80)'}` : 'none',
    transform: active ? 'scale(1.3)' : 'scale(1)',
    transition: 'transform 90ms ease-out, background 90ms ease-out',
  };
}

export const meterChip = (on: boolean): CSSProperties => ({
  borderRadius: 9,
  padding: '5px 9px',
  fontSize: 11.5,
  fontWeight: 900,
  cursor: 'pointer',
  fontVariantNumeric: 'tabular-nums',
  background: on ? 'oklch(97% 0.02 74)' : 'white',
  border: `1.5px solid ${on ? 'oklch(86% 0.04 66)' : 'oklch(91% 0.015 95)'}`,
  color: on ? TONE.chipInk : 'oklch(52% 0.02 150)',
});

export const secBtn: CSSProperties = {
  flex: 1,
  background: 'white',
  border: '1.5px solid oklch(90% 0.015 95)',
  borderRadius: 12,
  padding: '11px 0',
  fontSize: 12,
  fontWeight: 900,
  color: 'oklch(40% 0.02 150)',
  cursor: 'pointer',
};

/** Start/Stop. The only place the do-tone appears — and only while it is actually clicking. */
export const runBtn = (running: boolean): CSSProperties => ({
  flex: 1,
  border: running ? 'none' : '1.5px solid oklch(86% 0.04 66)',
  borderRadius: 12,
  padding: '11px 0',
  fontSize: 12.5,
  fontWeight: 900,
  cursor: 'pointer',
  color: running ? 'white' : TONE.chipInk,
  background: running ? `linear-gradient(180deg, ${TONE.fillA} 0%, ${TONE.fillB} 46%)` : 'oklch(98% 0.015 74)',
});

export const caption: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 900,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: TONE.sub,
};

/** The "Add a metronome" offer on a practice step with no dock — the pill's quiet cousin: same
 *  shape, dashed rather than solid, so it reads as an empty slot rather than a running control. */
export const addPill: CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  border: '1px dashed oklch(84% 0.03 85)',
  borderRadius: 16,
  background: 'transparent',
  padding: '10px 14px',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 12.5,
  fontWeight: 800,
  color: TONE.sub,
};
