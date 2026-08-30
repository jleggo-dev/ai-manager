import { useState } from 'react';
import { type MetronomeSpec, MAX_BPM, METERS, MIN_BPM, isDownbeat, tempoMarking } from '@cadence/shared';
import { useMetronome } from './useMetronome.ts';
import * as S from './metronomeStyles.ts';

/**
 * The metronome dock — a pulse that rides along with whatever tool the step already has.
 *
 * It renders ONLY where the coach attached one (`step.metronome`), which is what keeps it out of
 * the way on the ninety per cent of steps that are a plank or a sit. Collapsed it is a one-line
 * pill; open it is the tempo, the bar, and three controls. Collapsing does **not** stop the click:
 * the dock is a control panel, not the metronome itself, and someone who has it running and wants
 * their screen back should keep the beat.
 *
 * The tempo number is the thing you read from the bench, so it is set in the display face at 40px
 * with the Italian marking under it — the line that connects the number on screen to the word at
 * the top of the score.
 */
export function Metronome({ spec, title }: { spec: MetronomeSpec; title: string }) {
  const [open, setOpen] = useState(false);
  const m = useMetronome(spec, title);

  return (
    <div style={S.dock}>
      <button
        style={S.pill}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Metronome, ${m.bpm} beats per minute${m.running ? ', running' : ''}. ${open ? 'Collapse' : 'Expand'}`}
      >
        {/* At rest a static note; running, it blinks the downbeat so a collapsed dock still shows
            the pulse it is keeping. */}
        <span
          style={{
            ...S.pillNote,
            transform: m.running && m.beat === 0 ? 'scale(1.25)' : 'scale(1)',
            transition: 'transform 90ms ease-out',
          }}
          aria-hidden
        >
          ♩
        </span>
        <span style={S.pillBpm}>
          {m.bpm} bpm{m.meter > 1 ? ` · ${m.meter}/4` : ''}
        </span>
        <span style={S.pillHint}>{open ? 'Hide' : m.running ? 'Running' : 'Metronome'}</span>
      </button>

      {open && (
        <div style={S.body}>
          <div style={{ textAlign: 'center' }}>
            <div style={S.bpmNumber}>♩ = {m.bpm}</div>
            <div style={S.marking}>{tempoMarking(m.bpm)}</div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button style={S.stepper} onClick={() => m.nudge(-1)} aria-label="One beat slower">
              −
            </button>
            <input
              type="range"
              style={S.slider}
              min={MIN_BPM}
              max={MAX_BPM}
              value={m.bpm}
              onChange={(e) => m.setBpm(Number(e.target.value))}
              aria-label="Tempo in beats per minute"
            />
            <button style={S.stepper} onClick={() => m.nudge(1)} aria-label="One beat faster">
              +
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* The bar, drawn out. The lit dot is where the click just landed. */}
            <div style={S.dotRow} aria-hidden>
              {Array.from({ length: m.meter }, (_, i) => (
                <span key={i} style={S.dot(m.running && m.beat === i, isDownbeat(i, m.meter))} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 5, marginLeft: 'auto' }}>
              {METERS.map((n) => (
                <button
                  key={n}
                  style={S.meterChip(m.meter === n)}
                  onClick={() => m.setMeter(n)}
                  aria-pressed={m.meter === n}
                  aria-label={`${n} beats to the bar`}
                >
                  {n}/4
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button style={S.secBtn} onClick={m.tap}>
              Tap tempo
            </button>
            <button style={S.runBtn(m.running)} onClick={m.toggle}>
              {m.running ? '■ Stop' : '▶ Start'}
            </button>
          </div>

          <div style={{ ...S.caption, textAlign: 'center' }}>
            {m.nudged ? (
              <button
                style={{ ...S.caption, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                onClick={m.reset}
              >
                ↺ Back to {spec.bpm}
              </button>
            ) : (
              'Tap four beats to set it by ear'
            )}
          </div>
        </div>
      )}
    </div>
  );
}
