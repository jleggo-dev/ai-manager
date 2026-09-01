import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { StepReps } from './StepReps.tsx';

describe('StepReps — counted, logged, set by set', () => {
  it('logs the first set at the target reps, then advances to set 2', () => {
    const onLog = vi.fn();
    render(<StepReps sets={3} reps={10} onLog={onLog} />);
    fireEvent.click(screen.getByText('Log set 1 · 10 reps'));
    expect(onLog).toHaveBeenCalledWith({ kind: 'reps', sets: [10], target: 10, load: undefined });
  });

  it('partial credit: logging one of three sets shows "Set 2 of 3" next, not "done"', () => {
    render(<StepReps sets={3} reps={10} log={{ kind: 'reps', sets: [10] }} onLog={() => {}} />);
    expect(screen.getByText('Set 2 of 3')).toBeInTheDocument();
    expect(screen.getByText('Log set 2 · 10 reps')).toBeInTheDocument();
  });

  it('reaching every set disables further logging and reads back the total', () => {
    render(<StepReps sets={2} reps={10} log={{ kind: 'reps', sets: [10, 10] }} onLog={() => {}} />);
    expect(screen.getByText('Sets logged · 2 of 2')).toBeDisabled();
  });

  it('degrades honestly: no load param means the delta reset chip has nothing to show for it', () => {
    // With no target `reps`, the "on target" delta line never renders — there's no target to be
    // on or off of, so the step must not fabricate one.
    render(<StepReps sets={2} onLog={() => {}} />);
    expect(screen.queryByText('On target')).not.toBeInTheDocument();
  });

  it('the +/- dial adjusts the logged count before committing', () => {
    const onLog = vi.fn();
    render(<StepReps sets={1} reps={10} onLog={onLog} />);
    fireEvent.click(screen.getByLabelText('one more rep'));
    fireEvent.click(screen.getByLabelText('one more rep'));
    fireEvent.click(screen.getByText('Log set 1 · 12 reps'));
    expect(onLog).toHaveBeenCalledWith({ kind: 'reps', sets: [12], target: 10, load: undefined });
  });

  it('carries the load through to the log so it can ride the receipt', () => {
    const onLog = vi.fn();
    render(<StepReps sets={1} reps={10} load="35 lb" onLog={onLog} />);
    fireEvent.click(screen.getByText('Log set 1 · 10 reps'));
    expect(onLog).toHaveBeenCalledWith({ kind: 'reps', sets: [10], target: 10, load: '35 lb' });
  });
});
