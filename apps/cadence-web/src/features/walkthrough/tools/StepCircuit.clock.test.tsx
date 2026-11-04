/**
 * A circuit move tagged with seconds read "30s hold — self-timed" and showed no clock (owner's gym
 * session, 2026-11-02). Now it gets a countdown: started by a tap that also opens the audio, chiming
 * at zero, and at zero moving the circuit on by the same path the Log move button takes — so the
 * round's log is the same shape whether the clock or the thumb finished the move.
 *
 * Ticks advance in slices, each flushed in its own `act`, for the reason autoAdvance.test.tsx gives.
 * Fake timers also fake `Date.now()`, which is what the wall clock reads.
 */
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WalkthroughStep } from '@cadence/shared';
import { StepCircuit } from './StepCircuit.tsx';

const audio = vi.hoisted(() => ({ unlock: vi.fn(), chime: vi.fn() }));
vi.mock('./chime.ts', async (orig) => {
  const real = await orig<typeof import('./chime.ts')>();
  return { ...real, unlockAudio: audio.unlock, playChime: audio.chime };
});

const STEP: WalkthroughStep = { id: 's1', title: 'Core circuit', minutes: 5, tool: { kind: 'read' }, skippable: true };
const PLANK = { name: 'Plank', seconds: 30 };
const DEAD_BUG = { name: 'Dead bug', reps: 8 };

function tick(totalMs: number, stepMs = 250) {
  for (let t = 0; t < totalMs; t += stepMs) {
    act(() => {
      vi.advanceTimersByTime(stepMs);
    });
  }
}
const press = (label: string | RegExp) => fireEvent.click(screen.getByRole('button', { name: label }));

describe('StepCircuit — a timed move gets a real countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    audio.unlock.mockReset();
    audio.chime.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows a clock and a Start button, not "self-timed"', () => {
    render(<StepCircuit step={STEP} rounds={1} exercises={[PLANK, DEAD_BUG]} onLog={vi.fn()} onAdvance={vi.fn()} />);
    expect(screen.queryByText(/self-timed/)).toBeNull();
    expect(screen.getByText('0:30')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start · 0:30' })).toBeInTheDocument();
  });

  it('the Start tap opens the audio, and the clock counts down from the tap', () => {
    render(<StepCircuit step={STEP} rounds={1} exercises={[PLANK, DEAD_BUG]} onLog={vi.fn()} onAdvance={vi.fn()} />);
    press('Start · 0:30');
    expect(audio.unlock).toHaveBeenCalledTimes(1);
    tick(10_000);
    expect(screen.getByText('0:20')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('reaching zero chimes once and moves on to the next move, the way Log move does', () => {
    const onLog = vi.fn();
    render(<StepCircuit step={STEP} rounds={1} exercises={[PLANK, DEAD_BUG]} onLog={onLog} onAdvance={vi.fn()} />);
    expect(screen.getByText('Move 1 of 2')).toBeInTheDocument();

    press('Start · 0:30');
    tick(31_000);
    expect(audio.chime).toHaveBeenCalledTimes(1);
    tick(1_000); // the 600 ms hand-off beat

    expect(screen.getByText('Move 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('Now · 2nd of 2')).toBeInTheDocument();
    // Mid-round, nothing is written yet — exactly as a tap on Log move behaves.
    expect(onLog).not.toHaveBeenCalled();
    expect(audio.chime).toHaveBeenCalledTimes(1);
  });

  it('a timed move that ends the round logs the round in the unchanged shape and advances the circuit', () => {
    const onLog = vi.fn();
    const onAdvance = vi.fn();
    render(<StepCircuit step={STEP} rounds={1} exercises={[DEAD_BUG, PLANK]} onLog={onLog} onAdvance={onAdvance} />);
    press(/^Log 8 · next move/);

    press('Start · 0:30');
    tick(31_000);
    tick(1_000);

    expect(onLog).toHaveBeenCalledWith({ kind: 'circuit', roundsDone: 1, totalRounds: 1 });
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it('Pause keeps the seconds done; Resume carries on without a pre-roll', () => {
    render(<StepCircuit step={STEP} rounds={1} exercises={[PLANK]} onLog={vi.fn()} onAdvance={vi.fn()} />);
    press('Start · 0:30');
    tick(10_000);
    press('Pause');
    tick(5_000);
    expect(screen.getByText('0:20')).toBeInTheDocument();
    press('Resume');
    expect(screen.queryByText('Get in position')).toBeNull();
    tick(5_000);
    expect(screen.getByText('0:15')).toBeInTheDocument();
  });

  it('Log move still logs a timed move early, and the next move opens with its own fresh clock', () => {
    render(
      <StepCircuit
        step={STEP}
        rounds={1}
        exercises={[PLANK, { name: 'Side plank', seconds: 20 }]}
        onLog={vi.fn()}
        onAdvance={vi.fn()}
      />,
    );
    press('Start · 0:30');
    tick(10_000);
    press(/^Log move · next move/);
    expect(screen.getByText('Move 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('0:20')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start · 0:20' })).toBeInTheDocument();
    tick(2_000);
    expect(audio.chime).not.toHaveBeenCalled(); // the abandoned clock is gone, not still running
  });

  it('a reps move is untouched: the dial, no clock, no Start', () => {
    render(<StepCircuit step={STEP} rounds={1} exercises={[DEAD_BUG, PLANK]} onLog={vi.fn()} onAdvance={vi.fn()} />);
    expect(screen.getByText('reps')).toBeInTheDocument(); // the dial's own label
    expect(screen.getByRole('button', { name: 'one more rep' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Start/ })).toBeNull();
    expect(screen.queryByText(/^\d:\d\d$/)).toBeNull();
  });
});

describe('StepCircuit — a timed move left running (walkthrough v3 R6)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    audio.chime.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('keeps counting at app level while the circuit is away, chimes at zero, and reopens caught up', () => {
    render(<StepCircuit step={STEP} rounds={1} exercises={[PLANK, DEAD_BUG]} onLog={vi.fn()} onAdvance={vi.fn()} />);
    press('Start · 0:30');
    tick(10_000);
    cleanup(); // the step is left; the clock is not
    tick(5_000);
    render(<StepCircuit step={STEP} rounds={1} exercises={[PLANK, DEAD_BUG]} onLog={vi.fn()} onAdvance={vi.fn()} />);
    expect(screen.getByText('0:15')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    tick(16_000);
    expect(audio.chime).toHaveBeenCalledTimes(1);
  });

  it('Log move while the clock runs lets the clock go — it does not chime later for a move already logged', () => {
    render(<StepCircuit step={STEP} rounds={1} exercises={[PLANK, DEAD_BUG]} onLog={vi.fn()} onAdvance={vi.fn()} />);
    press('Start · 0:30');
    tick(10_000);
    press(/^Log move · next move/);
    tick(30_000);
    expect(audio.chime).not.toHaveBeenCalled();
  });
});
