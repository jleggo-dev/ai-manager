/**
 * autoAdvance.test.tsx presses Start-to-completion and Reset-inside-the-hand-off-window, but never
 * presses "Pause" mid-run — the primary button's OTHER branch, which logs the PARTIAL elapsed time
 * (`done: false`) rather than the full duration. That's the exact "a button's label promised a log
 * and the wire call didn't match" shape the owner is hardening against, so it gets its own press.
 *
 * Ticks advance in 100 ms slices to a rendered countdown value rather than a hand-computed
 * millisecond count — the pre-roll → running hand-off lands on a timer boundary, so counting our
 * own milliseconds to it is exactly the kind of off-by-one the ring itself is immune to (it reads
 * its own elapsed state, not a clock we're guessing at).
 */
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StepTimer } from './StepTimer.tsx';

/** Advances in 100 ms slices, each flushed on its own, until `text` is on screen. */
function tickUntilText(text: string, maxMs = 20_000, stepMs = 100) {
  for (let t = 0; t < maxMs; t += stepMs) {
    if (screen.queryByText(text)) return;
    act(() => {
      vi.advanceTimersByTime(stepMs);
    });
  }
}

describe('StepTimer — Pause logs the partial elapsed time, not the target', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('pausing part-way through logs done: false at the elapsed seconds so far, and does not hand off', () => {
    const onDone = vi.fn();
    const onLog = vi.fn();
    render(<StepTimer seconds={60} chime={false} onLog={onLog} onDone={onDone} />);

    fireEvent.click(screen.getByText(/^Start/));
    tickUntilText('0:50'); // 10 s into the 60 s clock — clears the pre-roll on its own

    fireEvent.click(screen.getByText('Pause'));

    expect(onLog).toHaveBeenCalledWith({ kind: 'timer', elapsedSec: 10, targetSec: 60, done: false });
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(onDone).not.toHaveBeenCalled();
  });

  it('Resume after a pause picks the clock back up without the pre-roll running again', () => {
    const onLog = vi.fn();
    render(<StepTimer seconds={60} chime={false} onLog={onLog} onDone={() => {}} />);

    fireEvent.click(screen.getByText(/^Start/));
    tickUntilText('0:55'); // 5 s in
    fireEvent.click(screen.getByText('Pause'));
    expect(onLog).toHaveBeenLastCalledWith({ kind: 'timer', elapsedSec: 5, targetSec: 60, done: false });

    fireEvent.click(screen.getByText('Resume'));
    // No "Get in position" pre-roll copy on resume — it goes straight back to counting down.
    expect(screen.queryByText('Get in position')).toBeNull();
  });
});
