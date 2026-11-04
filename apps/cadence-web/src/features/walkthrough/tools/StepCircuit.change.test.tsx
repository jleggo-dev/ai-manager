/**
 * "Change this move" on a circuit (walkthrough v3 Phase 5): the Change button sits on the current
 * move's row, a swapped move carries the pill and Undo, a weight the person added shows in the
 * move's target and is written into the round's log by move index.
 */
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { WalkthroughStep } from '@cadence/shared';
import { StepCircuit } from './StepCircuit.tsx';

const step: WalkthroughStep = { id: 's1', title: 'Abs circuit', minutes: 6, tool: { kind: 'read' }, skippable: true };
const exercises = [
  { name: 'Glute bridge', reps: 12 },
  { name: 'Kettlebell hip thrust', reps: 12, load: '40 lb', swapped_from: 'Dead bug' },
];

afterEach(cleanup);

describe('StepCircuit — Change this move', () => {
  it('Change on the current move asks for that move; the row shows the added weight', () => {
    const onChange = vi.fn();
    render(
      <StepCircuit
        step={step}
        rounds={2}
        exercises={exercises}
        workingLoads={{ '0': '15 lb' }}
        onLog={vi.fn()}
        onAdvance={vi.fn()}
        onChange={onChange}
      />,
    );
    expect(screen.getByText('12 reps × 15 lb')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(onChange).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole('button', { name: /^Log 12 · next move/ }));
    expect(screen.getByText('12 reps × 40 lb')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it('a swapped move carries the pill, and Undo names the move', () => {
    const onUndoSwap = vi.fn();
    render(
      <StepCircuit
        step={step}
        rounds={2}
        exercises={exercises}
        onLog={vi.fn()}
        onAdvance={vi.fn()}
        onUndoSwap={onUndoSwap}
      />,
    );
    expect(screen.queryByText(/Swapped from/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Log 12 · next move/ }));
    expect(screen.getByText('Swapped from Dead bug')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndoSwap).toHaveBeenCalledWith(1);
  });

  it("the round's log carries the loads by move index — and nothing when none was added", () => {
    const onLog = vi.fn();
    render(<StepCircuit step={step} rounds={2} exercises={exercises} onLog={onLog} onAdvance={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Log 12 · next move/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Log round 1/ }));
    expect(onLog).toHaveBeenLastCalledWith({ kind: 'circuit', roundsDone: 1, totalRounds: 2 });
    cleanup();
    render(
      <StepCircuit
        step={step}
        rounds={2}
        exercises={exercises}
        workingLoads={{ '0': '15 lb', '1': undefined }}
        onLog={onLog}
        onAdvance={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Log 12 · next move/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Log round 1/ }));
    expect(onLog).toHaveBeenLastCalledWith({ kind: 'circuit', roundsDone: 1, totalRounds: 2, loads: { '0': '15 lb' } });
  });

  it('no onChange: no Change button (a preview, an ad-hoc run)', () => {
    render(<StepCircuit step={step} rounds={2} exercises={exercises} onLog={vi.fn()} onAdvance={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
  });
});
