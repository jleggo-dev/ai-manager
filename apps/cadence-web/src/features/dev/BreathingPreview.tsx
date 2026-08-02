import { useState } from 'react';
import {
  BREATH_PATTERNS,
  DEFAULT_CYCLES,
  clampCycles,
  patternCounts,
  type BreathPatternId,
  type MeditateBells,
} from '@cadence/shared';
import { StepBreathing } from '../walkthrough/tools/StepBreathing.tsx';
import { StepMeditate } from '../walkthrough/tools/StepMeditate.tsx';
import type { StepLog } from '../walkthrough/state.ts';

type BreathingLog = Extract<StepLog, { kind: 'breathing' }>;

/**
 * A dev-only harness for the breath pacer, reachable at `?preview=breathing` with no API, no auth
 * and no plan. It exists because the pacer is the one tool whose correctness is *temporal* — the
 * phase transitions, the pre-roll hand-off, the double inhale and the side-to-side cues can only
 * really be judged by watching them, and waiting on a coach-composed session to do that is a slow
 * loop. Every pattern in the bank is one tap away here.
 *
 * Not routed, not linked, and dev-only by URL — it renders the real component with real data, so
 * what you see here is what a prescribed step plays.
 */
export function BreathingPreview() {
  const [id, setId] = useState<BreathPatternId>('box');
  const [cycles, setCycles] = useState(DEFAULT_CYCLES);
  const [last, setLast] = useState<BreathingLog | null>(null);
  const [runKey, setRunKey] = useState(0);

  const pattern = BREATH_PATTERNS.find((p) => p.id === id) ?? BREATH_PATTERNS[0];
  if (!pattern) return null;
  const played = clampCycles(pattern, cycles);

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14, background: 'oklch(96% 0.015 95)' }}>
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.55 }}>
        Breath pacer · dev preview
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {BREATH_PATTERNS.map((p) => (
          <button
            key={p.id}
            onClick={() => {
              setId(p.id);
              setLast(null);
              setRunKey((k) => k + 1);
            }}
            style={{
              border: p.id === id ? '1.5px solid oklch(76% 0.15 55)' : '1.5px solid oklch(90% 0.015 95)',
              background: p.id === id ? 'oklch(95% 0.05 68)' : 'white',
              borderRadius: 999,
              padding: '7px 11px',
              fontSize: 11.5,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            {p.name} <span style={{ opacity: 0.6 }}>{patternCounts(p)}</span>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, fontWeight: 800 }}>
        <span>Rounds</span>
        <input
          type="range"
          min={1}
          max={20}
          value={cycles}
          onChange={(e) => {
            setCycles(Number(e.target.value));
            setRunKey((k) => k + 1);
          }}
          style={{ flex: 1 }}
        />
        <span style={{ minWidth: 78, textAlign: 'right', opacity: 0.7 }}>
          asked {cycles} · plays {played}
        </span>
      </div>

      <StepBreathing
        key={`${id}-${played}-${runKey}`}
        pattern={pattern}
        cycles={played}
        caution={pattern.caution}
        onLog={setLast}
        onDone={() => undefined}
      />

      <div style={{ fontSize: 11.5, lineHeight: 1.5, opacity: 0.7 }}>
        {last ? `logged → ${last.roundsDone} of ${last.totalRounds} rounds (${last.pattern})` : 'no log yet'}
      </div>
    </div>
  );
}

/** The sit, with a short duration so the close (and the came-back sentence) is reachable in a dev
 *  loop rather than ten minutes away. */
export function MeditatePreview() {
  const [bells, setBells] = useState<MeditateBells>('start_end');
  const [last, setLast] = useState<Extract<StepLog, { kind: 'meditate' }> | null>(null);
  const [runKey, setRunKey] = useState(0);
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14, background: 'oklch(96% 0.015 95)' }}>
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.55 }}>
        Sit · dev preview
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {(['none', 'start_end', 'interval'] as MeditateBells[]).map((b) => (
          <button
            key={b}
            onClick={() => {
              setBells(b);
              setLast(null);
              setRunKey((k) => k + 1);
            }}
            style={{
              border: b === bells ? '1.5px solid oklch(76% 0.15 55)' : '1.5px solid oklch(90% 0.015 95)',
              background: b === bells ? 'oklch(95% 0.05 68)' : 'white',
              borderRadius: 999,
              padding: '7px 11px',
              fontSize: 11.5,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            {b}
          </button>
        ))}
      </div>
      <StepMeditate
        key={`${bells}-${runKey}`}
        seconds={60}
        bells={bells}
        intervalMin={1}
        onLog={setLast}
        onDone={() => setRunKey((k) => k + 1)}
      />
      <div style={{ fontSize: 11.5, lineHeight: 1.5, opacity: 0.7 }}>
        {last ? `logged → ${last.elapsedSec}/${last.targetSec}s · returns=${last.returns}` : 'no log yet'}
      </div>
    </div>
  );
}
