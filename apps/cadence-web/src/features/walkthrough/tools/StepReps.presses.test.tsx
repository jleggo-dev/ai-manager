/**
 * StepReps.test.tsx already presses the dial and the commit button once. What it never presses:
 * the logged chips themselves ("tap a logged chip to re-open + edit it" — the component's own
 * doc comment), the delta-reset chip that snaps the dial back to target, and a genuine two-tap
 * sequence (press set 1, the parent re-renders with the updated log, press set 2) rather than a
 * single mount pre-seeded with a log prop.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { StepReps } from './StepReps.tsx';

describe('StepReps — editing an already-logged set', () => {
  it('tapping a logged chip re-opens that set for editing, and Save writes the edited value back in place', () => {
    const onLog = vi.fn();
    render(<StepReps sets={2} reps={10} log={{ kind: 'reps', sets: [10, 10] }} onLog={onLog} />);

    // Both sets are logged (the "full" / disabled state) — tapping set 1's chip must still open it.
    fireEvent.click(screen.getByText('Set 1'));
    fireEvent.click(screen.getByLabelText('one more rep'));
    fireEvent.click(screen.getByText('Save set 1 · 11 reps'));

    expect(onLog).toHaveBeenCalledWith({ kind: 'reps', sets: [11, 10], target: 10, load: undefined });
  });
});

describe('StepReps — the delta line resets the dial to target before committing', () => {
  it('bumping over target, then tapping the reset line, commits at the target rather than the bumped value', () => {
    const onLog = vi.fn();
    render(<StepReps sets={1} reps={10} onLog={onLog} />);

    fireEvent.click(screen.getByLabelText('one more rep'));
    fireEvent.click(screen.getByLabelText('one more rep'));
    expect(screen.getByText('Log set 1 · 12 reps')).toBeInTheDocument();

    fireEvent.click(screen.getByText('+2 over target · reset to 10'));
    fireEvent.click(screen.getByText('Log set 1 · 10 reps'));

    expect(onLog).toHaveBeenCalledWith({ kind: 'reps', sets: [10], target: 10, load: undefined });
  });
});

describe('StepReps — a real two-tap sequence, not a pre-seeded mount', () => {
  it('logging set 1, then set 2 after the parent hands the updated log back, calls onLog twice with the growing array', () => {
    const onLog = vi.fn();
    const { rerender } = render(<StepReps sets={3} reps={10} onLog={onLog} />);

    fireEvent.click(screen.getByText('Log set 1 · 10 reps'));
    expect(onLog).toHaveBeenNthCalledWith(1, { kind: 'reps', sets: [10], target: 10, load: undefined });

    // The walkthrough shell would re-render StepReps with the log it just wrote — simulate that.
    rerender(<StepReps sets={3} reps={10} log={{ kind: 'reps', sets: [10] }} onLog={onLog} />);
    expect(screen.getByText('Log set 2 · 10 reps')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Log set 2 · 10 reps'));
    expect(onLog).toHaveBeenNthCalledWith(2, { kind: 'reps', sets: [10, 10], target: 10, load: undefined });
  });
});
