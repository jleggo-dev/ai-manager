import { useState, type CSSProperties } from 'react';
import type { StepLog } from '../state.ts';
import { TONE } from './tone.ts';

type MeasureLog = Extract<StepLog, { kind: 'measure' }>;

/**
 * Measure — "a number: weight, distance" (tool palette, Capture). One numeric entry, the unit
 * named by the step's own params (`metric`/`unit`, see `measureTool` in walkthrough.ts). The
 * figure is kept EXACTLY as typed — never reparsed or rounded — so what lands in the log is what
 * the person actually entered, the same honest-log rule the timer follows for elapsed time.
 *
 * Deliberately narrow: this writes to the OCCURRENCE LOG only, through `onLog` → the walkthrough's
 * commit-on-Finish path. It is NOT wired to the body-weight trend/baseline (`WeightTrend` in
 * types/baseline.ts) even when `metric` reads "Weight" — folding a session measurement into that
 * trend is a real integration call (dedup against Settings › weigh-ins, unit conversion, which
 * value wins on the same day) that belongs to whoever wires the orchestrator, not this step. See
 * the write site below.
 */
export function StepMeasure({
  metric,
  unit,
  log,
  onLog,
}: {
  metric: string;
  unit: string;
  log?: MeasureLog;
  onLog: (l: MeasureLog) => void;
}) {
  const [value, setValue] = useState(log?.value ?? '');
  const done = !!log;
  const trimmed = value.trim();
  const valid = trimmed.length > 0 && !Number.isNaN(Number(trimmed));

  function commit() {
    if (!valid) return;
    // Occurrence log only — see the file header. No baseline/trend write belongs here.
    onLog({ kind: 'measure', value: trimmed, unit, metric });
  }

  return (
    <div style={card}>
      <div style={labelStyle}>{metric}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        <input
          style={numInput}
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={done}
          aria-label={metric}
        />
        {unit && <span style={unitStyle}>{unit}</span>}
      </div>
      <button style={{ ...logBtn, opacity: done || !valid ? 0.62 : 1 }} onClick={commit} disabled={done || !valid}>
        {done ? `✓ Logged · ${log.value}${unit ? ` ${unit}` : ''}` : 'Log this'}
      </button>
    </div>
  );
}

const card: CSSProperties = {
  background: 'white',
  border: '1px solid oklch(91% 0.015 85)',
  borderRadius: 18,
  padding: 18,
  boxShadow: '0 1px 3px oklch(0% 0 0 / 0.04)',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};
const labelStyle: CSSProperties = {
  fontSize: 12.5,
  fontWeight: 800,
  letterSpacing: '0.02em',
  color: TONE.sub,
  textAlign: 'center',
};
const numInput: CSSProperties = {
  flex: 1,
  maxWidth: 180,
  border: '1px solid oklch(90% 0.015 95)',
  borderRadius: 14,
  padding: '14px 16px',
  fontFamily: 'var(--display), serif',
  fontWeight: 600,
  fontSize: 30,
  color: TONE.ink,
  textAlign: 'center',
  outline: 'none',
};
const unitStyle: CSSProperties = { fontSize: 15, fontWeight: 800, color: TONE.sub, flex: 'none' };
const logBtn: CSSProperties = {
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
