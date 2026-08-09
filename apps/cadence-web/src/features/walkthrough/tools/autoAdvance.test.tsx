import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { patternById, singleSetPlan, type WalkthroughStep } from '@cadence/shared';
import { StepTimer } from './StepTimer.tsx';
import { StepBreathing } from './StepBreathing.tsx';
import { StepInterval } from './StepInterval.tsx';

/**
 * The auto-advance regression (found in StepInterval, same shape here). A completion effect that
 * both (a) calls setState on something in its own dependency array and (b) returns
 * `() => clearTimeout(id)` for the `setTimeout(onDone, N)` it just scheduled will never advance:
 * the setState changes a dep, React runs the cleanup on the very next commit, and the hand-off is
 * cancelled before it fires. The step sits on its finished screen forever.
 *
 * These tests drive the real components on fake timers, so they fail loudly if the timeout is ever
 * put back under the effect's own cleanup.
 */

/** Longer than the 5 s grey pre-roll, so the run has actually started. */
const PREROLL_MS = 6_000;

/**
 * Advance in small slices, each in its own `act`. Both components schedule their next timer from an
 * effect, so a render has to be flushed between fires — one big `advanceTimersByTime` would fire
 * the single pending timeout and then find the queue empty.
 */
function tick(totalMs: number, stepMs = 100) {
  for (let t = 0; t < totalMs; t += stepMs) {
    act(() => {
      vi.advanceTimersByTime(stepMs);
    });
  }
}

/** Run the clock until `ready()`, so a test can act *inside* the sub-second hand-off window. */
function tickUntil(ready: () => boolean, maxMs = 120_000, stepMs = 100) {
  for (let t = 0; t < maxMs && !ready(); t += stepMs) {
    act(() => {
      vi.advanceTimersByTime(stepMs);
    });
  }
}

describe('walkthrough tools that auto-advance', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('StepTimer hands off to the next step when the clock runs out', () => {
    const onDone = vi.fn();
    const onLog = vi.fn();
    render(<StepTimer seconds={60} chime={false} onLog={onLog} onDone={onDone} />);

    fireEvent.click(screen.getByText(/^Start/));
    tick(PREROLL_MS); // grey pre-roll
    tick(60_000); // the minute itself

    // It logged the full duration...
    expect(onLog).toHaveBeenCalledWith({ kind: 'timer', elapsedSec: 60, targetSec: 60, done: true });

    // ...and the 600 ms hand-off must survive the setPhase('idle') that precedes it.
    tick(2_000);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('StepBreathing hands off to the next step when the last round finishes', () => {
    const onDone = vi.fn();
    const onLog = vi.fn();
    const box = patternById('box'); // 4·4·4·4 → 16 s per round
    render(<StepBreathing pattern={box} cycles={2} onLog={onLog} onDone={onDone} />);

    fireEvent.click(screen.getByText('Begin'));
    tick(PREROLL_MS); // grey pre-roll
    tick(33_000); // two 16 s rounds, plus a tick to cross the finish

    expect(onLog).toHaveBeenCalledWith({ kind: 'breathing', roundsDone: 2, totalRounds: 2, pattern: 'box' });

    // The 700 ms hand-off must survive the setPhase('idle') that precedes it.
    tick(2_000);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('unmounting mid-hand-off does not fire onDone into a dead step', () => {
    const onDone = vi.fn();
    const onLog = vi.fn();
    const { unmount } = render(<StepTimer seconds={60} chime={false} onLog={onLog} onDone={onDone} />);

    fireEvent.click(screen.getByText(/^Start/));
    tickUntil(() => onLog.mock.calls.length > 0); // stop the moment it completes

    unmount(); // the user closed the walkthrough inside the 600 ms window
    tick(2_000);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('StepTimer Reset inside the hand-off window keeps you on the step', () => {
    const onDone = vi.fn();
    const onLog = vi.fn();
    render(<StepTimer seconds={60} chime={false} onLog={onLog} onDone={onDone} />);

    fireEvent.click(screen.getByText(/^Start/));
    tickUntil(() => onLog.mock.calls.length > 0);

    fireEvent.click(screen.getByText('Reset'));
    tick(2_000);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('StepBreathing starting again inside the hand-off window keeps you on the step', () => {
    const onDone = vi.fn();
    const onLog = vi.fn();
    render(<StepBreathing pattern={patternById('box')} cycles={2} onLog={onLog} onDone={onDone} />);

    fireEvent.click(screen.getByText('Begin'));
    tickUntil(() => onLog.mock.calls.length > 0);

    fireEvent.click(screen.getByRole('button', { name: /Begin|Go again/ }));
    tick(2_000);
    expect(onDone).not.toHaveBeenCalled();
  });

  /* StepInterval is where this was found. Same two guarantees, and one of its own: the receipt
     must describe the run that happened, not the prescription. */
  const INTERVAL_STEP: WalkthroughStep = {
    id: 's1',
    title: 'Bike sprints',
    minutes: 1,
    tool: { kind: 'read' },
    skippable: true,
  };
  const quickPlan = () => singleSetPlan({ workSec: 5, recoverSec: 5, rounds: 2 });

  it('StepInterval hands off to the next step when the last phase ends', () => {
    const onDone = vi.fn();
    const onLog = vi.fn();
    render(<StepInterval step={INTERVAL_STEP} plan={quickPlan()} onLog={onLog} onDone={onDone} />);

    fireEvent.click(screen.getByText(/^Start/));
    tick(PREROLL_MS); // grey pre-roll
    tick(21_000); // 2 rounds of 5/5, plus a tick to cross the finish

    expect(onLog).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'interval', roundsDone: 2, totalRounds: 2, shorthand: '2 × 5/5' }),
    );

    // The 600 ms hand-off must survive the setStatus('done') that precedes it.
    tick(2_000);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('StepInterval Restart inside the hand-off window keeps you on the step', () => {
    const onDone = vi.fn();
    const onLog = vi.fn();
    render(<StepInterval step={INTERVAL_STEP} plan={quickPlan()} onLog={onLog} onDone={onDone} />);

    fireEvent.click(screen.getByText(/^Start/));
    tickUntil(() => onLog.mock.calls.some((c) => c[0]?.roundsDone === 2));

    fireEvent.click(screen.getByText('Restart'));
    tick(2_000);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('StepInterval logs the rounds actually done, never the prescription', () => {
    const onDone = vi.fn();
    const onLog = vi.fn();
    render(<StepInterval step={INTERVAL_STEP} plan={quickPlan()} onLog={onLog} onDone={onDone} />);

    fireEvent.click(screen.getByText(/^Start/));
    tick(PREROLL_MS);
    // Skip straight through every phase. Two work phases cut short = zero rounds earned, even
    // though the clock reached the end — "2 × 5/5 · done" here would be a lie.
    for (let i = 0; i < 4; i += 1) {
      fireEvent.click(screen.getByText(/^Skip phase/));
      tick(300);
    }
    tick(2_000);

    expect(onLog).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'interval', roundsDone: 0 }));
  });
});
