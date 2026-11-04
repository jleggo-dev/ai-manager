import type { CSSProperties } from 'react';

/** The bottom sheet of design A (Redlines): r 22 top, padding 10 18 26, a 40 × 5 grab, the sheet
 *  shadow, on the oat-white #fbf9f4 under the 32% scrim. Shared by the Change and weight sheets. */
export const sheetScrim: CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(44, 47, 51, 0.32)',
  zIndex: 70,
};
export const sheetFrame: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 71,
  background: '#fbf9f4',
  borderRadius: '22px 22px 0 0',
  boxShadow: '0 -18px 44px -18px rgba(44, 40, 32, 0.35)',
  padding: '10px 18px 26px',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  maxHeight: '88%',
};
export const sheetGrab: CSSProperties = {
  width: 40,
  height: 5,
  borderRadius: 3,
  background: '#dcd2bc',
  alignSelf: 'center',
  flex: 'none',
};
export const sheetTitle: CSSProperties = { fontSize: 18, fontWeight: 700, color: '#2c2f33' };
export const sheetSubtitle: CSSProperties = { fontFamily: 'var(--mono)', fontSize: 12, color: '#5c5f63', marginTop: 3 };
export const sheetEyebrow: CSSProperties = {
  fontSize: 12.5,
  fontWeight: 800,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#5c5f63',
  marginTop: 6,
};
/** A white row card: r 14, 1px #eae2d0, the soft shadow. */
export const sheetRow: CSSProperties = {
  textAlign: 'left',
  background: 'white',
  border: '1px solid #eae2d0',
  borderRadius: 14,
  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  cursor: 'pointer',
  fontFamily: 'inherit',
};
export const rowTitle: CSSProperties = { fontSize: 14.5, fontWeight: 800, color: '#2c2f33' };
export const meta: CSSProperties = { fontFamily: 'var(--mono)', fontSize: 11.5, color: '#5c5f63' };
