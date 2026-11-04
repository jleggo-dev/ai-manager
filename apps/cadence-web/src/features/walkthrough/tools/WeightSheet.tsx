import { useState, type CSSProperties } from 'react';
import { LOAD_STEP, NO_LOAD, formatLoad, parseLoad, type LoadUnit } from '@cadence/shared';
import { COMMIT } from './tone.ts';
import { shortDate } from '../change-text.ts';
import { sheetFrame, sheetGrab, sheetScrim, sheetSubtitle, sheetTitle } from './sheet-styles.ts';

/**
 * The weight control (design A, board 1a): − / + in 2.5 lb (or 1 kg) steps around a real decimal
 * field, "Jump to" chips for the loads that carry a reason — the coach's suggestion, last time,
 * none — and one green "Use 7.5 lb". Opened from the Change sheet's "Add weight" row and from the
 * quiet "Change weight" button under a card; either way `onUse` hands back one load string and the
 * caller decides which set it applies to. Nothing explains the control: the number is the control.
 */
export function WeightSheet({
  title,
  name,
  targetWord,
  unit,
  start,
  suggested,
  last,
  onUse,
  onBack,
}: {
  title: 'Add weight' | 'Change weight';
  name: string;
  /** The move's own number, for the subtitle: "12 REPS", "45 S". */
  targetWord: string;
  unit: LoadUnit;
  /** The number the dial opens on; 0 is none. */
  start: number;
  /** The coach's "my suggestion" chip, when she gave one. */
  suggested?: string;
  /** The "last time · Oct 28" chip, when there is history. */
  last?: { load: string; date: string };
  onUse: (load: string) => void;
  onBack: () => void;
}) {
  const step = LOAD_STEP[unit];
  const [value, setValue] = useState(start);
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? trim(value);
  const commitLabel = value > 0 ? `Use ${formatLoad(value, unit)}` : `Use ${NO_LOAD}`;

  const set = (n: number) => {
    setTyped(null);
    setValue(Math.max(0, Math.round(n * 100) / 100));
  };
  const type = (raw: string) => {
    setTyped(raw);
    const n = Number(raw.replace(',', '.'));
    if (raw.trim() !== '' && Number.isFinite(n) && n >= 0) setValue(n);
  };

  const suggestedN = parseLoad(suggested);
  const lastN = parseLoad(last?.load);
  const chips: Array<{ big: string; small: string; to: number }> = [];
  if (suggestedN)
    chips.push({ big: formatLoad(suggestedN.value, suggestedN.unit), small: 'my suggestion', to: suggestedN.value });
  if (lastN && last)
    chips.push({
      big: formatLoad(lastN.value, lastN.unit),
      small: `last time · ${shortDate(last.date)}`,
      to: lastN.value,
    });
  chips.push({ big: 'None', small: NO_LOAD, to: 0 });

  return (
    <>
      <div style={sheetScrim} onClick={onBack} aria-hidden />
      <div style={{ ...sheetFrame, gap: 16 }} role="dialog" aria-label={title}>
        <div style={sheetGrab} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button type="button" aria-label="Back to Change this move" onClick={onBack} style={backBtn}>
            ‹
          </button>
          <div style={{ textAlign: 'center' }}>
            <div style={sheetTitle}>{title}</div>
            <div style={{ ...sheetSubtitle, fontSize: 11.5, marginTop: 0 }}>
              {[name, targetWord].filter(Boolean).join(' · ').toUpperCase()}
            </div>
          </div>
          <div style={{ width: 34 }} />
        </div>

        <div
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '6px 0' }}
        >
          <button type="button" aria-label={`${step} ${unit} less`} onClick={() => set(value - step)} style={dial}>
            −
          </button>
          <label style={field}>
            <span style={srOnly}>Weight in {unit === 'lb' ? 'pounds' : 'kilograms'}</span>
            <input
              type="text"
              inputMode="decimal"
              value={shown}
              onChange={(e) => type(e.target.value)}
              onBlur={() => setTyped(null)}
              style={input}
            />
            <span style={{ fontSize: 20, fontWeight: 700, color: '#5c5f63' }}>{unit}</span>
          </label>
          <button type="button" aria-label={`${step} ${unit} more`} onClick={() => set(value + step)} style={dial}>
            +
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={eyebrow}>Jump to</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {chips.map((c) => (
              <button key={c.small} type="button" onClick={() => set(c.to)} style={chip}>
                <span style={{ fontSize: 15, fontWeight: 900, color: '#2c2f33' }}>{c.big}</span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#5c5f63' }}>{c.small}</span>
              </button>
            ))}
          </div>
        </div>

        <button type="button" onClick={() => onUse(formatLoad(value, unit))} style={useBtn}>
          {commitLabel}
        </button>
      </div>
    </>
  );
}

/** "7.5", "15" — never "15.00". */
function trim(n: number): string {
  return String(Math.round(n * 100) / 100);
}

const backBtn: CSSProperties = {
  width: 44,
  height: 44,
  marginLeft: -10,
  border: 'none',
  background: 'transparent',
  fontSize: 20,
  color: '#5c5f63',
  textAlign: 'left',
  cursor: 'pointer',
};
const dial: CSSProperties = {
  width: 64,
  height: 56,
  flex: 'none',
  border: 'none',
  borderRadius: 999,
  background: 'linear-gradient(180deg,#fff 0%,oklch(96% 0.01 85) 46%)',
  boxShadow: '0 4px 0 oklch(88% 0.02 85), 0 0 0 1px oklch(92% 0.015 85)',
  fontSize: 26,
  fontWeight: 800,
  color: 'oklch(40% 0.02 150)',
  cursor: 'pointer',
};
const field: CSSProperties = {
  flex: 1,
  height: 72,
  boxSizing: 'border-box',
  borderRadius: 16,
  border: '2px solid #2c5545',
  background: 'white',
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'center',
  gap: 4,
  paddingTop: 10,
  boxShadow: '0 0 0 4px oklch(92% 0.03 152)',
  position: 'relative',
};
const input: CSSProperties = {
  width: 96,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  textAlign: 'right',
  fontFamily: 'inherit',
  fontWeight: 600,
  fontSize: 46,
  lineHeight: 1,
  color: '#2c2f33',
  fontVariantNumeric: 'tabular-nums',
  padding: 0,
};
const srOnly: CSSProperties = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' };
const eyebrow: CSSProperties = {
  fontSize: 12.5,
  fontWeight: 800,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#5c5f63',
};
const chip: CSSProperties = {
  flex: 1,
  minHeight: 56,
  borderRadius: 14,
  border: '1px solid #dcd2bc',
  background: 'white',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 1,
  cursor: 'pointer',
};
const useBtn: CSSProperties = {
  height: 54,
  border: 'none',
  borderRadius: 16,
  fontSize: 15,
  fontWeight: 900,
  color: 'white',
  cursor: 'pointer',
  ...COMMIT,
  boxShadow: '0 3px 0 oklch(39% 0.08 152)',
};
