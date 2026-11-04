import { type CSSProperties } from 'react';
import type { ExerciseHistoryLine, SessionItemAlternative } from '@cadence/shared';
import { alternativeTarget, lastLine } from '../change-text.ts';
import {
  meta,
  rowTitle,
  sheetEyebrow,
  sheetFrame,
  sheetGrab,
  sheetRow,
  sheetScrim,
  sheetSubtitle,
  sheetTitle,
} from './sheet-styles.ts';

/**
 * "Change this move" (design A, board 1): one list — Add weight first (or Change weight once a
 * weight is on), then "Or swap for…" rows, each with the move's name, its target, an equipment chip
 * and either what the person last did ("Last 3 × 10 · 25 lb · Oct 28") or a New pill, then the
 * dashed "Something else" row. Tapped, that row shows three dawn dots and "asking · ~20 s" while the
 * coach looks, and her pick lands as a new swap row above it — nothing waits on it. A fault is one
 * plain line on the row, and the row can be tapped again. Nothing on the sheet explains itself.
 *
 * The sheet is pure: history and the ask are the caller's (ChangeFlow.tsx), handed in as facts.
 */
export type AskState = { kind: 'idle' } | { kind: 'asking' } | { kind: 'fault' };

export function ChangeSheet({
  subtitle,
  canAddWeight,
  hasWeight,
  rows,
  history,
  ask,
  onAddWeight,
  onSwap,
  onSomethingElse,
  onClose,
}: {
  subtitle: string;
  canAddWeight: boolean;
  /** A weight is already on this move, so the first row reads Change weight. */
  hasWeight: boolean;
  rows: SessionItemAlternative[];
  /** The last time each row's move was logged, by the move's name; absent = still loading. */
  history: Record<string, ExerciseHistoryLine | null | undefined>;
  ask: AskState;
  onAddWeight: () => void;
  onSwap: (alt: SessionItemAlternative) => void;
  onSomethingElse: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div style={sheetScrim} onClick={onClose} aria-hidden />
      <div style={sheetFrame} role="dialog" aria-label="Change this move">
        <div style={sheetGrab} />
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={sheetTitle}>Change this move</div>
            <div style={sheetSubtitle}>{subtitle}</div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} style={closeBtn}>
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', minHeight: 0 }}>
          {canAddWeight && (
            <button type="button" onClick={onAddWeight} style={{ ...sheetRow, ...addRow }}>
              <span style={plusDisc} aria-hidden>
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.7}
                  strokeLinecap="round"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
              <span style={{ flex: 1, ...rowTitle }}>{hasWeight ? 'Change weight' : 'Add weight'}</span>
              <span style={{ fontSize: 20, color: '#8b8d91' }} aria-hidden>
                ›
              </span>
            </button>
          )}
          {rows.length > 0 && <div style={sheetEyebrow}>Or swap for…</div>}
          {rows.map((alt) => (
            <SwapRow key={alt.name} alt={alt} last={history[alt.name]} onPick={() => onSwap(alt)} />
          ))}
          <button
            type="button"
            onClick={ask.kind === 'asking' ? undefined : onSomethingElse}
            aria-busy={ask.kind === 'asking'}
            style={{ ...somethingElse, ...(rows.length === 0 && !canAddWeight ? { marginTop: 0 } : {}) }}
          >
            <span style={{ width: 36, display: 'flex', gap: 4, justifyContent: 'center', flex: 'none' }} aria-hidden>
              {ask.kind === 'asking' ? (
                <>
                  <span style={dot} />
                  <span style={{ ...dot, opacity: 0.6 }} />
                  <span style={{ ...dot, opacity: 0.3 }} />
                </>
              ) : (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#5c5f63"
                  strokeWidth={1.7}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 12a8 8 0 0 1-8 8H6l-3 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z" />
                </svg>
              )}
            </span>
            <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={rowTitle}>Something else</span>
              {ask.kind === 'fault' && (
                <span style={{ fontSize: 12, color: '#5c5f63' }}>{"Couldn't reach the coach — try again"}</span>
              )}
            </span>
            {ask.kind === 'asking' ? (
              <span style={meta}>asking · ~20 s</span>
            ) : (
              <span style={{ fontSize: 20, color: '#8b8d91' }} aria-hidden>
                ›
              </span>
            )}
          </button>
        </div>
      </div>
    </>
  );
}

function SwapRow({
  alt,
  last,
  onPick,
}: {
  alt: SessionItemAlternative;
  last: ExerciseHistoryLine | null | undefined;
  onPick: () => void;
}) {
  const equipment = alt.equipment.length ? alt.equipment.join(' · ') : 'No tools';
  return (
    <button type="button" onClick={onPick} style={{ ...sheetRow, ...swapRow }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'baseline', gap: 8 }}>
        <span style={rowTitle}>{alt.name}</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: '#2c2f33', whiteSpace: 'nowrap' }}>
          {alternativeTarget(alt)}
        </span>
      </span>
      <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={equipmentChip}>{equipment}</span>
        {last === undefined ? null : last ? (
          <span style={{ ...meta, whiteSpace: 'nowrap' }}>{lastLine(last)}</span>
        ) : (
          <span style={newPill}>New</span>
        )}
      </span>
    </button>
  );
}

const closeBtn: CSSProperties = {
  width: 44,
  height: 44,
  border: 'none',
  background: 'transparent',
  fontSize: 16,
  color: '#5c5f63',
  margin: '-8px -10px 0 0',
  cursor: 'pointer',
};
const addRow: CSSProperties = { minHeight: 60, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 12 };
const plusDisc: CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: '50%',
  background: 'oklch(96% 0.025 152)',
  color: '#2c5545',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
};
const swapRow: CSSProperties = { padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 4 };
const equipmentChip: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: '#2c5545',
  background: 'oklch(95% 0.03 152)',
  borderRadius: 999,
  padding: '3px 9px',
  whiteSpace: 'nowrap',
};
const newPill: CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: 'oklch(38% 0.07 62)',
  background: 'oklch(94% 0.045 74)',
  borderRadius: 999,
  padding: '3px 9px',
};
const somethingElse: CSSProperties = {
  textAlign: 'left',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  border: '1px dashed #dcd2bc',
  borderRadius: 14,
  background: 'transparent',
  padding: '8px 12px',
  minHeight: 52,
  boxSizing: 'border-box',
  cursor: 'pointer',
  fontFamily: 'inherit',
};
const dot: CSSProperties = { width: 7, height: 7, borderRadius: '50%', background: '#e07a5f' };
