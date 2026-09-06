import type { CSSProperties } from 'react';
import { TONE } from './tone.ts';

/** The timer card's styles, out of the component so the component is only the clock. */
export const card: CSSProperties = {
  background: 'white',
  border: '1px solid oklch(91% 0.015 85)',
  borderRadius: 18,
  padding: 18,
  boxShadow: '0 1px 3px oklch(0% 0 0 / 0.04)',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};
export const logBtn: CSSProperties = {
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
export const footnote: CSSProperties = {
  borderTop: '1px solid oklch(93% 0.012 85)',
  paddingTop: 12,
  fontSize: 11.5,
  lineHeight: 1.4,
  color: 'oklch(48% 0.02 150)',
};
/** The halfway / time's-up cue — big enough to read from the floor. */
export const banner: CSSProperties = {
  padding: '8px 16px',
  borderRadius: 999,
  background: 'oklch(97% 0.02 74)',
  border: `1.5px solid ${TONE.fillA}`,
  fontSize: 15,
  fontWeight: 900,
  color: TONE.chipInk,
  textAlign: 'center',
};
export const doneRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
};
export const minutesInput: CSSProperties = {
  width: 64,
  border: '1px solid oklch(90% 0.015 95)',
  borderRadius: 12,
  padding: '10px 12px',
  fontSize: 15,
  fontWeight: 800,
  fontFamily: 'inherit',
  textAlign: 'center',
  color: 'oklch(30% 0.02 150)',
  outline: 'none',
};
