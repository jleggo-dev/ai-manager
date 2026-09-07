import { useState } from 'react';
import { DEFAULT_BPM, DEFAULT_METER, type MetronomeSpec, type WalkthroughStep } from '@cadence/shared';
import { Metronome } from './Metronome.tsx';
import * as S from './metronomeStyles.ts';

/** The goal areas, as the plan API sends them. Only `practice` matters here. */
export type StepArea = 'movement' | 'nourishment' | 'mind' | 'practice';

/**
 * Where a step's metronome goes — and, on a practice step, where one can be asked for.
 *
 * The coach attaches a metronome (`step.metronome`) and the dock renders where she did: a click is
 * furniture on a plank and a distraction on a sit, and she is the one who knows which steps are
 * played to a beat. That stance stays. What changed (2026-09-06): the owner sat down to scales with
 * no metronome and no way to get one, because the coach had left the field off. A step in a
 * PRACTICE-area session is the one place the person is as likely as the coach to know they want a
 * beat, so there — and only there — a plain step offers a one-line "Add a metronome". Tapping it
 * opens the same dock with the shared defaults, remembers the tempo by step title exactly as a
 * prescribed dock does, and reports the settled tempo up through `onSettle` so a piece the step
 * names gets the number back. Nothing here writes to the session; the coach's prescription is
 * unchanged and next time she sees the settled tempo in the shelf.
 *
 * Circuits and intervals never reach this component (they own their whole body); every other tool
 * on a practice step can carry a pulse, because "practice" already says someone is drilling
 * something — a journal step in a piano session is a practice log, and a practice log can have a beat.
 */
export function MetronomeSlot({
  step,
  area,
  onSettle,
}: {
  step: WalkthroughStep;
  area?: StepArea;
  onSettle: (tempo: MetronomeSpec) => void;
}) {
  const [asked, setAsked] = useState(false);

  if (step.metronome) {
    return (
      <div style={{ marginTop: 12 }}>
        <Metronome key={step.id} spec={step.metronome} title={step.title} onSettle={onSettle} />
      </div>
    );
  }
  if (area !== 'practice') return null;
  if (asked) {
    return (
      <div style={{ marginTop: 12 }}>
        <Metronome
          key={step.id}
          spec={{ bpm: DEFAULT_BPM, meter: DEFAULT_METER }}
          title={step.title}
          onSettle={onSettle}
          defaultOpen
        />
      </div>
    );
  }
  return (
    <div style={{ marginTop: 12 }}>
      <button style={S.addPill} onClick={() => setAsked(true)} aria-label="Add a metronome to this step">
        <span aria-hidden>♩</span> Add a metronome
      </button>
    </div>
  );
}
