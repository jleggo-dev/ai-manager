import type { CSSProperties, ReactNode } from 'react';
import type { IntervalPhaseKind } from '@cadence/shared';
import { INTERVAL_KIND, TONE } from './tone.ts';

/**
 * The edit sheet's row primitives, split out so `IntervalEditSheet` stays about composition.
 *
 * **Rows are one shape**: kind dot + label + `?` + `− pill +`. Every editable number in the sheet
 * uses it, so the steppers are learned once and a new row costs no new vocabulary.
 *
 * **Explanations are tooltips, not sub-lines.** A row carries only its name; the explainer lives
 * behind a 17px disc, one open at a time. That keeps the sheet scannable for the person who
 * already knows what a Tabata is, without abandoning the one who doesn't.
 */

const PILL: Record<IntervalPhaseKind, { bg: string; border: string; ink: string; dot: string }> = {
  work: {
    bg: 'oklch(97% 0.02 74)',
    border: 'oklch(86% 0.04 66)',
    ink: 'oklch(48% 0.11 60)',
    dot: INTERVAL_KIND.work.done,
  },
  recover: {
    bg: 'oklch(97% 0.015 152)',
    border: 'oklch(85% 0.04 152)',
    ink: 'oklch(42% 0.08 152)',
    dot: INTERVAL_KIND.recover.done,
  },
  neutral: {
    bg: 'oklch(97.5% 0.008 85)',
    border: 'oklch(90% 0.015 85)',
    ink: 'oklch(42% 0.02 150)',
    dot: INTERVAL_KIND.neutral.done,
  },
};

export function Stepper({ sign, onClick, label }: { sign: ReactNode; onClick: () => void; label: string }) {
  return (
    <button style={stepperBtn} onClick={onClick} aria-label={label}>
      {sign}
    </button>
  );
}

export function StepperRow({
  label,
  kind,
  value,
  tip,
  tipOpen,
  onTip,
  onMinus,
  onPlus,
  bare,
  icon,
  trailing,
  /** Distinguishes the two "Work" rows when there are two sets, for anyone using a screen reader. */
  scope,
}: {
  label: string;
  kind: IntervalPhaseKind;
  value: string;
  tip: string;
  tipOpen: boolean;
  onTip: () => void;
  onMinus: () => void;
  onPlus: () => void;
  /** The set-card header sits ON the card, so it drops the row's own white surface. */
  bare?: boolean;
  icon?: boolean;
  /** Rendered at the far left of a bare row — the set card's delete control lives here. */
  trailing?: ReactNode;
  scope?: string;
}) {
  const pill = PILL[kind];
  const named = scope ? `${label}, ${scope}` : label;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={bare ? bareRow : row}>
        {trailing}
        {/* The leading glyph gives way to the delete control rather than sitting beside it: at
            390px, two leading elements plus the label plus three controls clips the label, and
            between a decorative icon and a working button the icon is the one that goes. */}
        {trailing ? null : icon ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke={pill.ink}
            strokeWidth={2.4}
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M20 12a8 8 0 1 1-2.6-5.9" />
            <path d="M20 4v4h-4" />
          </svg>
        ) : (
          <div style={{ width: 10, height: 10, flex: 'none', borderRadius: '50%', background: pill.dot }} aria-hidden />
        )}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13.5,
              fontWeight: 900,
              color: TONE.ink,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {label}
          </div>
          <button style={tipDisc} onClick={onTip} aria-expanded={tipOpen} aria-label={`What is ${named}?`}>
            ?
          </button>
        </div>
        <Stepper sign="−" onClick={onMinus} label={`Less ${named}`} />
        <div style={{ ...valuePill, background: pill.bg, border: `1.5px solid ${pill.border}`, color: pill.ink }}>
          {value}
        </div>
        <Stepper sign="+" onClick={onPlus} label={`More ${named}`} />
      </div>
      {tipOpen && <div style={tipBubble}>{tip}</div>}
    </div>
  );
}

const row: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  background: 'white',
  border: '1px solid oklch(91% 0.015 85)',
  borderRadius: 14,
  padding: 12,
};
const bareRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '2px 2px 2px 4px' };
const tipDisc: CSSProperties = {
  width: 17,
  height: 17,
  flex: 'none',
  borderRadius: '50%',
  border: '1.5px solid oklch(85% 0.02 85)',
  background: 'transparent',
  color: 'oklch(55% 0.02 120)',
  fontSize: 10,
  fontWeight: 900,
  lineHeight: 1,
  padding: 0,
  cursor: 'pointer',
};
const tipBubble: CSSProperties = {
  alignSelf: 'flex-start',
  margin: '5px 0 2px 20px',
  background: 'oklch(30% 0.02 150)',
  color: 'oklch(96% 0.008 85)',
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1.45,
  borderRadius: 10,
  padding: '7px 11px',
  maxWidth: 280,
};
const stepperBtn: CSSProperties = {
  width: 38,
  height: 34,
  flex: 'none',
  border: 'none',
  borderRadius: 999,
  background: 'linear-gradient(180deg, #fff 0%, oklch(96% 0.01 85) 46%)',
  boxShadow: '0 3px 0 oklch(88% 0.02 85), 0 0 0 1px oklch(92% 0.015 85)',
  fontSize: 18,
  fontWeight: 800,
  color: 'oklch(40% 0.02 150)',
  cursor: 'pointer',
  padding: 0,
  lineHeight: 1,
};
const valuePill: CSSProperties = {
  // "15:00" is the widest value any row can hold, so 58 was buying nothing the labels needed more.
  minWidth: 52,
  textAlign: 'center',
  borderRadius: 999,
  padding: '6px 10px',
  fontSize: 13.5,
  fontWeight: 900,
  fontVariantNumeric: 'tabular-nums',
};
