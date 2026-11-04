import type { CSSProperties } from 'react';

/** The Rearrange sheet's and All steps' shared styles (Redlines: row r 14 · padding 10 12; pill
 *  h 30 · r 999 · padding 0 11; meta Space Mono 11.5 #5c5f63). */
export const rowFrame: CSSProperties = {
  borderRadius: 14,
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  boxSizing: 'border-box',
};
export const pillBase: CSSProperties = {
  height: 30,
  padding: '0 11px',
  borderRadius: 999,
  fontSize: 12.5,
  fontWeight: 800,
  display: 'inline-flex',
  alignItems: 'center',
  color: '#2c2f33',
  whiteSpace: 'nowrap',
};
export const rowTitle: CSSProperties = { fontSize: 14.5, fontWeight: 800, color: '#2c2f33' };

export const rowMeta: CSSProperties = { fontFamily: 'var(--mono)', fontSize: 11.5, color: '#5c5f63' };

export const pillRow: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 5 };

export const splitBtn: CSSProperties = {
  height: 28,
  padding: '0 2px',
  border: 'none',
  background: 'transparent',
  fontSize: 12,
  fontWeight: 800,
  color: '#5c5f63',
  marginLeft: 8,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
