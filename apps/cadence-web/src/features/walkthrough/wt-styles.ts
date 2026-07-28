import type { CSSProperties } from 'react';
import type { WalkthroughStep } from '@cadence/shared';
import { type StepLog, logLine } from './state.ts';
import { TONE } from './tools/tone.ts';

/* ── Shared derivations (kept out of the component files so react-refresh stays happy) ── */

/** The prescription, stated once, in the same grammar as the log line ("15 × light band · 2 sets"). */
export function targetChip(step: WalkthroughStep): string {
  const t = step.tool;
  if (t.kind === 'reps') {
    const head = [t.reps != null ? String(t.reps) : '', t.load ? `× ${t.load}` : ''].filter(Boolean).join(' ');
    return t.sets ? `${head}${head ? ' · ' : ''}${t.sets} sets` : head;
  }
  if (t.kind === 'timer') return `${Math.round(t.seconds / 60) || 1} min`;
  if (t.kind === 'checkoff') return t.label ?? '';
  return '';
}

/** The "what kind of thing is this" sub-line in the all-steps list when a step has no receipt yet. */
export function toolNoun(step: WalkthroughStep): string {
  const t = step.tool;
  if (t.kind === 'circuit') return `Circuit · ${t.rounds} rounds`;
  if (t.kind === 'timer') return `Timer · ${Math.round(t.seconds / 60) || 1} min`;
  if (t.kind === 'reps') return `${t.sets} × ${t.reps ?? ''}`.trim();
  if (t.kind === 'journal') return 'Journal · one line for the coach';
  return step.body ?? '';
}

/** The all-steps row's second line — the receipt of what happened, never the word "failed". */
export function rowReceipt(step: WalkthroughStep, log: StepLog | undefined, current: boolean, status: string): string {
  if (log) return logLine(step, log);
  if (current) return 'Here now';
  if (status === 'skipped') return 'Passed over · you can still do it';
  return toolNoun(step);
}

/** A short header label — strip the parenthetical qualifier and cap length, so the workout name in
 *  the control row stays one line (the design's "Strength · lower body") instead of wrapping. */
export function shortTitle(title: string): string {
  const stripped = title.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  return stripped.length > 30 ? `${stripped.slice(0, 29).trimEnd()}…` : stripped;
}

/** Name the how-to link by what it shows, the way the design does ("Form" / "Follow along"). */
export function videoLabel(kind: string): string {
  if (kind === 'reps') return 'Form';
  if (kind === 'timer') return 'Follow along';
  return 'How-to';
}

/* ── Shared styles ── */
export const overlay: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 60,
  background: TONE.tint,
  display: 'flex',
  flexDirection: 'column',
  padding: '20px 20px 28px',
  boxSizing: 'border-box',
};
export const center: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
};
export const closeBtn: CSSProperties = {
  width: 32,
  height: 32,
  flex: 'none',
  borderRadius: '50%',
  background: 'oklch(100% 0 0 / 0.6)',
  border: 'none',
  fontSize: 16,
  color: 'oklch(40% 0.04 60)',
  cursor: 'pointer',
};
export const caption: CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'oklch(52% 0.04 62)',
};
export const navBtn: CSSProperties = {
  height: 50,
  border: '1px solid oklch(90% 0.015 95)',
  borderRadius: 14,
  background: 'oklch(100% 0 0 / 0.85)',
  boxShadow: '0 4px 0 oklch(88% 0.02 85)',
  fontSize: 18,
  color: 'oklch(38% 0.02 150)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
export const chip: CSSProperties = {
  background: 'oklch(100% 0 0 / 0.7)',
  border: '1px solid oklch(86% 0.04 66)',
  borderRadius: 12,
  padding: '7px 11px',
  display: 'flex',
  alignItems: 'baseline',
  gap: 6,
};
export const sheet: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  background: 'oklch(97% 0.012 85)',
  borderRadius: '26px 26px 0 0',
  padding: '20px 20px 26px',
  boxShadow: '0 -8px 30px oklch(20% 0.03 262 / 0.25)',
  display: 'flex',
  flexDirection: 'column',
};
export const grab: CSSProperties = {
  width: 38,
  height: 4,
  borderRadius: 2,
  background: 'oklch(87% 0.02 85)',
  alignSelf: 'center',
  marginBottom: 16,
};
export const greenBtn: CSSProperties = {
  border: 'none',
  borderRadius: 16,
  padding: 15,
  fontSize: 15,
  fontWeight: 900,
  color: 'white',
  cursor: 'pointer',
  background: `linear-gradient(180deg, oklch(60% 0.10 152) 0%, ${TONE.green} 46%)`,
  boxShadow: `0 5px 0 ${TONE.greenEdge}`,
};
export const outlineBtn: CSSProperties = {
  border: '1.5px solid oklch(84% 0.03 85)',
  borderRadius: 16,
  padding: 14,
  fontSize: 14.5,
  fontWeight: 900,
  color: 'oklch(38% 0.02 150)',
  cursor: 'pointer',
  background: 'white',
};
export const recapCard: CSSProperties = {
  background: 'white',
  border: '1px solid oklch(91% 0.015 85)',
  borderRadius: 18,
  padding: 14,
  boxShadow: '0 1px 3px oklch(0% 0 0 / 0.04)',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};
export const sectionLabel: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 900,
  letterSpacing: '0.09em',
  textTransform: 'uppercase',
  color: TONE.sub,
};
export const skipAction: CSSProperties = {
  flex: 1,
  textAlign: 'center',
  borderRadius: 12,
  padding: '9px 0',
  fontSize: 12,
  fontWeight: 900,
  cursor: 'pointer',
};
