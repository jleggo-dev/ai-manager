/**
 * Load per set on the reps tool (walkthrough v3 Phase 5a): the set in hand is logged at the working
 * load, a logged set keeps the load it was logged at when its reps are edited, the chips carry each
 * set's load, and a step with no weight in play writes exactly the log it always did.
 */
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { StepReps } from './StepReps.tsx';

afterEach(cleanup);

describe('StepReps — loads', () => {
  it('no weight in play: the log has no loads key and the dial reads as before', () => {
    const onLog = vi.fn();
    render(<StepReps sets={2} reps={12} onLog={onLog} />);
    expect(screen.getByText('reps done')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Log set 1 · 12 reps'));
    expect(onLog).toHaveBeenCalledWith({ kind: 'reps', sets: [12], target: 12, load: undefined });
  });

  it('a plan load with no change: still no loads key, the dial names the load', () => {
    const onLog = vi.fn();
    render(<StepReps sets={2} reps={12} load="40 lb" onLog={onLog} />);
    expect(screen.getByText('reps · 40 lb')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Log set 1 · 12 reps'));
    expect(onLog).toHaveBeenCalledWith({ kind: 'reps', sets: [12], target: 12, load: '40 lb' });
  });

  it("a working load is written to the set logged, and earlier sets logged without one get the plan's", () => {
    const onLog = vi.fn();
    render(
      <StepReps
        sets={3}
        reps={12}
        load="bodyweight"
        workingLoad="15 lb"
        log={{ kind: 'reps', sets: [12] }}
        onLog={onLog}
      />,
    );
    expect(screen.getByText('reps · 15 lb')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Log set 2 · 12 reps'));
    expect(onLog).toHaveBeenCalledWith({
      kind: 'reps',
      sets: [12, 12],
      target: 12,
      load: 'bodyweight',
      loads: ['bodyweight', '15 lb'],
    });
  });

  it("editing a logged set's reps keeps the load it was logged at, whatever the working load is now", () => {
    const onLog = vi.fn();
    render(
      <StepReps
        sets={2}
        reps={12}
        load="bodyweight"
        workingLoad="20 lb"
        log={{ kind: 'reps', sets: [12, 12], loads: ['15 lb', '20 lb'] }}
        onLog={onLog}
      />,
    );
    fireEvent.click(screen.getByText('Set 1'));
    fireEvent.click(screen.getByLabelText('one fewer rep'));
    fireEvent.click(screen.getByText('Save set 1 · 11 reps'));
    expect(onLog).toHaveBeenCalledWith({
      kind: 'reps',
      sets: [11, 12],
      target: 12,
      load: 'bodyweight',
      loads: ['15 lb', '20 lb'],
    });
  });

  it("the chips carry each set's load, and the set in hand shows the load it will be logged at", () => {
    render(
      <StepReps
        sets={3}
        reps={12}
        load="bodyweight"
        workingLoad="20 lb"
        log={{ kind: 'reps', sets: [12, 12], loads: ['15 lb', '20 lb'] }}
        onLog={vi.fn()}
      />,
    );
    const chips = screen.getAllByText(/^Set [123]$/).map((el) => el.parentElement!.textContent);
    expect(chips).toEqual(['1215 lbSet 1', '1220 lbSet 2', '·20 lbSet 3']);
  });
});
