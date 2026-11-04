import type { CSSProperties } from 'react';

/**
 * The two small controls of "Change this move" that sit in a step's header (design A, Redlines):
 * the Change button beside the target — h 36, r 12, swap-arrows icon, 12/900 — and the pill
 * above a swapped step's title, "Swapped from glute bridge · Undo". Neither writes anything, so
 * neither wears commit green (pinned in commit-tone.test.tsx).
 */
export function SwapArrows({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 8h13l-3-3M20 16H7l3 3" />
    </svg>
  );
}

export function ChangeButton({ onClick, height = 36 }: { onClick: () => void; height?: number }) {
  return (
    <button type="button" onClick={onClick} style={{ ...changeBtn, height }}>
      <SwapArrows />
      Change
    </button>
  );
}

export function SwappedPill({ from, onUndo }: { from: string; onUndo: () => void }) {
  return (
    <div style={pill}>
      <span style={{ color: 'oklch(45% 0.06 62)', display: 'flex' }}>
        <SwapArrows />
      </span>
      <span style={{ fontSize: 12, fontWeight: 800, color: HEADER_INK }}>Swapped from {from}</span>
      <button type="button" onClick={onUndo} style={undoBtn}>
        Undo
      </button>
    </div>
  );
}

export const HEADER_INK = 'oklch(40% 0.06 62)';
export const HEADER_EDGE = '1px solid oklch(86% 0.04 66)';

const changeBtn: CSSProperties = {
  padding: '0 10px',
  borderRadius: 12,
  border: HEADER_EDGE,
  background: 'oklch(100% 0 0 / 0.7)',
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  fontSize: 12,
  fontWeight: 900,
  color: HEADER_INK,
  cursor: 'pointer',
};
const pill: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '0 4px 0 10px',
  borderRadius: 999,
  background: 'oklch(100% 0 0 / 0.6)',
  border: HEADER_EDGE,
  marginBottom: 8,
};
const undoBtn: CSSProperties = {
  height: 24,
  padding: '0 9px',
  borderRadius: 999,
  border: 'none',
  background: 'white',
  fontSize: 11.5,
  fontWeight: 900,
  color: HEADER_INK,
  cursor: 'pointer',
};
