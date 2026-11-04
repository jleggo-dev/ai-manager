import type { CSSProperties, ReactNode } from 'react';
import { rowFrame as row, pillBase as pill } from './rearrange-styles.ts';

/**
 * The pieces of the Rearrange sheet and the All-steps list (walkthrough v3 Phase 6, design
 * boards "Rearrange" and "All steps"): a group row with its title, meta and set pills; the pick
 * circle; the drag handle; the dashed gap a dragged thing can land in; the toast. Values are the
 * Redlines board's: row r 14, padding 10 12, 8 between rows; pill h 30, r 999, padding 0 11, gap 5;
 * pick circle 22 in a 44 hit area; handle 44 × 44.
 */

export function Pill({
  label,
  alt,
  timed,
  done,
  current,
  hole,
  style,
}: {
  label: string;
  alt?: boolean;
  timed?: boolean;
  done?: boolean;
  current?: boolean;
  hole?: boolean;
  style?: CSSProperties;
}) {
  if (hole)
    return (
      <span
        style={{
          ...pill,
          width: 86,
          boxSizing: 'border-box',
          border: '1.5px dashed #dcd2bc',
          background: 'transparent',
        }}
      />
    );
  const look: CSSProperties = done
    ? { background: 'oklch(52% 0.09 152)', color: 'white' }
    : alt
      ? { background: 'oklch(93% 0.035 152)', color: '#2c5545' }
      : timed
        ? { background: 'oklch(94% 0.045 74)', color: 'oklch(36% 0.08 62)' }
        : { background: '#f1ebdd' };
  return (
    <span
      style={{ ...pill, ...look, ...(current ? { boxShadow: 'inset 0 0 0 1.5px oklch(79% 0.16 70)' } : {}), ...style }}
    >
      {done ? `✓ ${label}` : label}
    </span>
  );
}

export function PickCircle({ picked, onToggle, label }: { picked: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={picked} aria-label={label} onClick={onToggle} style={pickHit}>
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          border: `2px solid ${picked ? '#2c5545' : '#dcd2bc'}`,
          background: picked ? '#2c5545' : 'white',
          boxSizing: 'border-box',
          display: 'block',
        }}
      />
    </button>
  );
}

export function DragHandle({
  label,
  color = '#8b8d91',
  onPointerDown,
}: {
  label: string;
  color?: string;
  onPointerDown?: (e: React.PointerEvent) => void;
}) {
  return (
    <span
      aria-label={label}
      role="button"
      onPointerDown={onPointerDown}
      style={{ ...handle, color, touchAction: 'none' }}
    >
      <Lines size={20} />
    </span>
  );
}

export function Lines({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M5 8h14M5 12h14M5 16h14" />
    </svg>
  );
}

/** The gap under your finger: a dashed green slot. */
export function Gap({ active }: { active: boolean }) {
  return (
    <div
      data-gap
      style={{
        height: active ? 52 : 0,
        marginTop: active ? 0 : -8,
        borderRadius: 14,
        border: active ? '2px dashed oklch(66% 0.11 152)' : 'none',
        background: active ? 'oklch(97% 0.015 152)' : 'transparent',
        transition: 'height 0.12s ease',
        boxSizing: 'border-box',
      }}
    />
  );
}

export function Toast({ words, onUndo }: { words: string; onUndo: () => void }) {
  return (
    <div role="status" style={toast}>
      <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, lineHeight: 1.4 }}>{words}</span>
      <button type="button" onClick={onUndo} style={toastUndo}>
        Undo
      </button>
    </div>
  );
}

export function RowFrame({
  children,
  look,
  style,
}: {
  children: ReactNode;
  look: 'plain' | 'picked' | 'combined' | 'current' | 'done';
  style?: CSSProperties;
}) {
  const border =
    look === 'picked'
      ? '2.5px dashed #2c5545'
      : look === 'combined'
        ? '2px solid oklch(66% 0.11 152)'
        : look === 'current'
          ? '1.5px solid oklch(79% 0.16 70)'
          : look === 'done'
            ? '1px solid transparent'
            : '1px solid #eae2d0';
  const background =
    look === 'picked'
      ? 'oklch(97% 0.02 152)'
      : look === 'combined'
        ? 'oklch(97.5% 0.015 152)'
        : look === 'done'
          ? '#f1ebdd'
          : 'white';
  return <div style={{ ...row, border, background, ...style }}>{children}</div>;
}

const pickHit: CSSProperties = {
  width: 44,
  height: 44,
  border: 'none',
  background: 'transparent',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  cursor: 'pointer',
  flex: 'none',
};

const handle: CSSProperties = {
  width: 44,
  height: 44,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  cursor: 'grab',
};

const toast: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 8px 8px 12px',
  borderRadius: 14,
  background: '#2c5545',
  color: 'white',
};

const toastUndo: CSSProperties = {
  height: 40,
  padding: '0 12px',
  border: 'none',
  borderRadius: 10,
  background: 'oklch(100% 0 0 / 0.16)',
  fontSize: 13,
  fontWeight: 900,
  color: 'white',
  cursor: 'pointer',
  fontFamily: 'inherit',
};
