/**
 * The reps tool hands off on its own once the last set is logged — "Sets logged · 1 of 1" was a
 * dead end that needed a second tap on › (Ankle circles, 2026-09-06). Same hand-off contract as
 * the timer: a beat to see the finished state, cancelled if the person re-opens a set to edit it,
 * and never fired by merely MOUNTING with a full log (coming back to a logged step must not throw
 * you forward again).
 */
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StepReps } from './StepReps.tsx';

describe('StepReps — auto-advance on the last set', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('a one-set step moves on a beat after its only set is logged', () => {
    const onDone = vi.fn();
    render(<StepReps sets={1} reps={10} onLog={() => {}} onDone={onDone} />);

    fireEvent.click(screen.getByText('Log set 1 · 10 reps'));
    expect(onDone).not.toHaveBeenCalled(); // the beat
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('an earlier set does not move on', () => {
    const onDone = vi.fn();
    render(<StepReps sets={3} reps={10} onLog={() => {}} onDone={onDone} />);
    fireEvent.click(screen.getByText('Log set 1 · 10 reps'));
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(onDone).not.toHaveBeenCalled();
  });

  it('re-opening a logged set inside the beat keeps you on the step', () => {
    const onDone = vi.fn();
    const { rerender } = render(<StepReps sets={1} reps={10} onLog={() => {}} onDone={onDone} />);
    fireEvent.click(screen.getByText('Log set 1 · 10 reps'));
    rerender(<StepReps sets={1} reps={10} log={{ kind: 'reps', sets: [10] }} onLog={() => {}} onDone={onDone} />);

    fireEvent.click(screen.getByText('Set 1'));
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(onDone).not.toHaveBeenCalled();
  });

  it('mounting with every set already logged does not fire — only the logging tap does', () => {
    const onDone = vi.fn();
    render(<StepReps sets={2} reps={10} log={{ kind: 'reps', sets: [10, 10] }} onLog={() => {}} onDone={onDone} />);
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(onDone).not.toHaveBeenCalled();
  });
});
