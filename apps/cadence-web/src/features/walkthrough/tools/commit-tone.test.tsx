/**
 * Owner ruling 2026-11-03: a walkthrough button that WRITES wears the design system's commit green;
 * amber is kept for what is in progress. Pins the split so a later "one amber for every tool" tidy-up
 * can't quietly undo it: the log button is green, the timer's Start/Pause face is still amber, and
 * both faces come from the single definitions in tone.ts.
 *
 * The table below presses each tool into the state where a button shows and reads its face. Several
 * tools share ONE style between a start button and a write button, so recolouring the style turned
 * Meditate's "Begin" and Grounding's mid-game "Got it" green with nothing failing — the rows with
 * `amber` are the near-misses that guard against that.
 */
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BREATH_PATTERNS, groundingSpec, singleSetPlan, type WalkthroughStep } from '@cadence/shared';
import { StepReps } from './StepReps.tsx';
import { StepTimer } from './StepTimer.tsx';
import { StepInterval } from './StepInterval.tsx';
import { StepCircuit } from './StepCircuit.tsx';
import { StepMeditate } from './StepMeditate.tsx';
import { StepBreathing } from './StepBreathing.tsx';
import { StepGrounding } from './StepGrounding.tsx';
import { StepMeasure } from './StepMeasure.tsx';
import { StepCheckoff } from './SimpleTools.tsx';
import { COMMIT, TONE } from './tone.ts';
import { logBtn as timerFace } from './timerStyles.ts';
import { greenBtn } from '../wt-styles.ts';

/**
 * jsdom rewrites oklch(60% …) as oklch(0.6 …), so read the hue: every stop of the commit gradient
 * sits on hue 152 (green); the amber do-tone is hue 68–70. Anything else (the grey pre-roll) is other.
 */
function face(el: HTMLElement): 'commit' | 'amber' | 'other' {
  const hues = [...el.style.background.matchAll(/oklch\([^)]*?\s(\d+)\)/g)].map((m) => Number(m[1]));
  if (hues.length && hues.every((h) => h === 152)) return 'commit';
  if (hues.length && hues.every((h) => h >= 60 && h <= 75)) return 'amber';
  return 'other';
}

const button = (label: string | RegExp) => screen.getByRole('button', { name: label });
const press = (label: string | RegExp) => fireEvent.click(button(label));

/** Advances in 100 ms slices until `label` names a button — pre-rolls land on timer boundaries. */
function tickUntilButton(label: string | RegExp, maxMs = 20_000) {
  for (let t = 0; t < maxMs; t += 100) {
    if (screen.queryByRole('button', { name: label })) return;
    act(() => {
      vi.advanceTimersByTime(100);
    });
  }
}

const STEP: WalkthroughStep = { id: 's1', title: 'Step', minutes: 1, tool: { kind: 'read' }, skippable: true };

type Row = [name: string, setup: () => void, label: string | RegExp, expected: 'commit' | 'amber'];

const ROWS: Row[] = [
  // Writes → commit green.
  ['reps: Log set', () => render(<StepReps sets={2} reps={10} onLog={vi.fn()} />), 'Log set 1 · 10 reps', 'commit'],
  [
    'circuit: Log move',
    () =>
      render(
        <StepCircuit
          step={STEP}
          rounds={2}
          exercises={[
            { name: 'Plank', seconds: 30 },
            { name: 'Dead bug', reps: 8 },
          ]}
          onLog={vi.fn()}
          onAdvance={vi.fn()}
        />,
      ),
    /^Log move · next move/,
    'commit',
  ],
  ['measure: Log this', () => render(<StepMeasure metric="Weight" unit="kg" onLog={vi.fn()} />), 'Log this', 'commit'],
  ['check-off: Log this done', () => render(<StepCheckoff onLog={vi.fn()} />), 'Log this done', 'commit'],
  [
    'timer: Stop · log past the target',
    () => {
      render(<StepTimer seconds={5} chime={false} openEnded onLog={vi.fn()} onDone={vi.fn()} />);
      press(/^Start/);
      tickUntilButton(/^Stop · log/);
    },
    /^Stop · log/,
    'commit',
  ],
  [
    'meditate: End here',
    () => {
      render(<StepMeditate seconds={600} bells="none" intervalMin={0} onLog={vi.fn()} onDone={vi.fn()} />);
      press('Begin · 10 min');
      press('Skip the count · start now');
    },
    'End here',
    'commit',
  ],
  [
    'breathing: Stop here',
    () => {
      render(<StepBreathing pattern={BREATH_PATTERNS[0]!} cycles={3} onLog={vi.fn()} onDone={vi.fn()} />);
      press('Begin');
      press('Skip the count · start now');
    },
    'Stop here',
    'commit',
  ],
  [
    'grounding: the last card finishes and logs',
    () => {
      render(<StepGrounding spec={groundingSpec('switch')} onLog={vi.fn()} onDone={vi.fn()} />);
      for (let i = 0; i < 5; i++) press('Got it');
    },
    'Got it',
    'commit',
  ],
  [
    'grounding: Done after the game',
    () => {
      render(<StepGrounding spec={groundingSpec('cold')} onLog={vi.fn()} onDone={vi.fn()} />);
      press("I'm done");
    },
    'Done',
    'commit',
  ],
  // Starts, pauses and mid-game moves → amber. The near-misses.
  [
    'timer: Start',
    () => render(<StepTimer seconds={60} chime={false} onLog={vi.fn()} onDone={vi.fn()} />),
    /^Start/,
    'amber',
  ],
  [
    'interval: Start',
    () =>
      render(
        <StepInterval
          step={STEP}
          plan={singleSetPlan({ workSec: 5, recoverSec: 5, rounds: 2 })}
          onLog={vi.fn()}
          onDone={vi.fn()}
        />,
      ),
    /^Start ·/, // the primary; the ring's own tap target is also named "Start"
    'amber',
  ],
  [
    'circuit: Start the clock on a timed move',
    () =>
      render(
        <StepCircuit
          step={STEP}
          rounds={1}
          exercises={[{ name: 'Plank', seconds: 30 }]}
          onLog={vi.fn()}
          onAdvance={vi.fn()}
        />,
      ),
    'Start · 0:30',
    'amber',
  ],
  [
    'meditate: Begin',
    () => render(<StepMeditate seconds={600} bells="none" intervalMin={0} onLog={vi.fn()} onDone={vi.fn()} />),
    'Begin · 10 min',
    'amber',
  ],
  [
    'breathing: Begin',
    () => render(<StepBreathing pattern={BREATH_PATTERNS[0]!} cycles={3} onLog={vi.fn()} onDone={vi.fn()} />),
    'Begin',
    'amber',
  ],
  [
    'grounding: Got it mid-game only moves you on',
    () => render(<StepGrounding spec={groundingSpec('switch')} onLog={vi.fn()} onDone={vi.fn()} />),
    'Got it',
    'amber',
  ],
];

describe('commit green vs in-progress amber', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it.each(ROWS)('%s', (_name, setup, label, expected) => {
    setup();
    expect(face(button(label))).toBe(expected);
  });

  it('the commit face is green and the amber do-tone is what it guards against', () => {
    expect(COMMIT.background).toContain(' 152)');
    expect(TONE.fillA).toContain(' 70)');
  });

  it('the timer Start/Pause face stays amber; only the over-target Stop · log swaps to green at render', () => {
    expect(timerFace.background).toContain(TONE.fillA);
    expect(timerFace.boxShadow).toBe(`0 5px 0 ${TONE.deep}`);
  });

  it('the shell greenBtn (Finish, Done) and COMMIT are one definition', () => {
    expect(greenBtn.background).toBe(COMMIT.background);
    expect(greenBtn.boxShadow).toBe(COMMIT.boxShadow);
  });
});
