import { useState } from 'react';
import { DEFAULT_METER, type MetronomeSpec, tempoMarking } from '@cadence/shared';
import { Metronome } from '../walkthrough/tools/Metronome.tsx';

/**
 * A dev harness for the metronome dock, at `?preview=metronome` with no API, no auth and no plan.
 *
 * It exists for the same reason the interval player's does: this tool's correctness is **temporal**.
 * A unit test can prove `tapTempo` averages correctly and `beatIndexAt` is a pure function of
 * elapsed time; it cannot tell you whether the click is actually steady, whether the dot lights on
 * the beat rather than 120 ms before it, or whether dragging the slider stutters the pulse. Those
 * are the things this feature lives or dies on, and they can only be judged by ear.
 *
 * Two presets sit here because the failure modes differ at the extremes: 60 is where a scheduling
 * bug shows up as a late click, 184 is where it shows up as a wobble.
 */
const PRESETS: { label: string; spec: MetronomeSpec }[] = [
  { label: 'Adagio 60', spec: { bpm: 60, meter: 4 } },
  { label: 'Andante 92 · 3/4', spec: { bpm: 92, meter: 3 } },
  { label: 'Presto 184', spec: { bpm: 184, meter: DEFAULT_METER } },
];

export function MetronomePreview() {
  const [i, setI] = useState(0);
  const preset = PRESETS[i] as { label: string; spec: MetronomeSpec };

  return (
    <div style={{ padding: 20, maxWidth: 420, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontFamily: 'var(--display), serif', fontSize: 24, fontWeight: 600 }}>Metronome</div>
        <div style={{ fontSize: 12, color: 'oklch(52% 0.02 120)', marginTop: 4 }}>
          Judge it by ear: the click should be steady, and the dot should land with the sound.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        {PRESETS.map((p, n) => (
          <button
            key={p.label}
            onClick={() => setI(n)}
            style={{
              flex: 1,
              borderRadius: 10,
              padding: '8px 4px',
              fontSize: 11,
              fontWeight: 800,
              cursor: 'pointer',
              background: i === n ? 'oklch(97% 0.02 74)' : 'white',
              border: `1.5px solid ${i === n ? 'oklch(86% 0.04 66)' : 'oklch(91% 0.015 95)'}`,
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Keyed on the preset so switching re-seeds from the coach's tempo rather than carrying the
          previous one across — the same remount the walkthrough does when you change step. */}
      <Metronome key={preset.label} spec={preset.spec} title={`preview ${preset.label}`} />

      <div style={{ fontSize: 11.5, lineHeight: 1.5, color: 'oklch(48% 0.02 150)' }}>
        Prescribed: ♩ = {preset.spec.bpm} ({tempoMarking(preset.spec.bpm)}), {preset.spec.meter} to the bar. The dock
        remembers what you last used per step title, so reopening this preset should bring your tempo back.
      </div>
    </div>
  );
}
