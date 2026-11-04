/**
 * The weight control (design A, board 1a). Every button: − / + step by the unit's step, a chip
 * jumps, the field takes a decimal, Use hands back one load string with the unit spelled, None is
 * bodyweight. lb and kg are a table because the step differs (2.5 lb, 1 kg).
 */
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { WeightSheet } from './WeightSheet.tsx';

const press = (label: string | RegExp) => fireEvent.click(screen.getByRole('button', { name: label }));

afterEach(cleanup);

describe("WeightSheet — the dial steps in the person's unit", () => {
  it.each<['lb' | 'kg', number, string, string, string]>([
    ['lb', 5, 'Use 7.5 lb', 'Use 10 lb', 'Use 5 lb'],
    ['kg', 5, 'Use 6 kg', 'Use 7 kg', 'Use 5 kg'],
  ])('%s: + steps up, − steps down', (unit, start, afterPlus, afterTwoPlus, afterBackDown) => {
    render(
      <WeightSheet
        title="Add weight"
        name="Glute bridge"
        targetWord="12 reps"
        unit={unit}
        start={start}
        onUse={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    press(new RegExp(`${unit} more`));
    expect(screen.getByText(afterPlus)).toBeInTheDocument();
    press(new RegExp(`${unit} more`));
    expect(screen.getByText(afterTwoPlus)).toBeInTheDocument();
    press(new RegExp(`${unit} less`));
    press(new RegExp(`${unit} less`));
    expect(screen.getByText(afterBackDown)).toBeInTheDocument();
  });

  it('never goes below none, and none reads bodyweight', () => {
    render(
      <WeightSheet
        title="Add weight"
        name="Glute bridge"
        targetWord="12 reps"
        unit="lb"
        start={2.5}
        onUse={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    press(/lb less/);
    press(/lb less/);
    expect(screen.getByText('Use bodyweight')).toBeInTheDocument();
  });
});

describe('WeightSheet — the field, the chips and Use', () => {
  it('a typed decimal is the load', () => {
    const onUse = vi.fn();
    render(
      <WeightSheet
        title="Add weight"
        name="Glute bridge"
        targetWord="12 reps"
        unit="lb"
        start={0}
        onUse={onUse}
        onBack={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '12.5' } });
    press('Use 12.5 lb');
    expect(onUse).toHaveBeenCalledWith('12.5 lb');
  });

  it('shows only the chips that carry a reason, and each jumps the dial', () => {
    const onUse = vi.fn();
    render(
      <WeightSheet
        title="Add weight"
        name="Glute bridge"
        targetWord="12 reps"
        unit="lb"
        start={7.5}
        suggested="15 lb"
        last={{ load: '25 lb', date: '2026-10-28' }}
        onUse={onUse}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText('my suggestion')).toBeInTheDocument();
    expect(screen.getByText('last time · Oct 28')).toBeInTheDocument();
    expect(screen.getByText('bodyweight')).toBeInTheDocument();
    press(/my suggestion/);
    expect(screen.getByText('Use 15 lb')).toBeInTheDocument();
    press(/last time/);
    expect(screen.getByText('Use 25 lb')).toBeInTheDocument();
    press(/bodyweight/);
    press('Use bodyweight');
    expect(onUse).toHaveBeenCalledWith('bodyweight');
  });

  it('no suggestion and no history: only None', () => {
    render(
      <WeightSheet
        title="Change weight"
        name="Glute bridge"
        targetWord="12 reps"
        unit="kg"
        start={10}
        onUse={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.queryByText('my suggestion')).toBeNull();
    expect(screen.queryByText(/last time/)).toBeNull();
    expect(screen.getByText('bodyweight')).toBeInTheDocument();
    expect(screen.getByText('Change weight')).toBeInTheDocument();
    expect(screen.getByText('GLUTE BRIDGE · 12 REPS')).toBeInTheDocument();
  });

  it('a suggestion the dial cannot read ("2×40 lb") is no chip, not a broken one', () => {
    render(
      <WeightSheet
        title="Add weight"
        name="Carry"
        targetWord="45 s"
        unit="lb"
        start={0}
        suggested="2×40 lb"
        onUse={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.queryByText('my suggestion')).toBeNull();
  });

  it('Back goes back', () => {
    const onBack = vi.fn();
    render(
      <WeightSheet
        title="Add weight"
        name="Glute bridge"
        targetWord="12 reps"
        unit="lb"
        start={0}
        onUse={vi.fn()}
        onBack={onBack}
      />,
    );
    press('Back to Change this move');
    expect(onBack).toHaveBeenCalled();
  });

  it('draws no line that explains the control', () => {
    render(
      <WeightSheet
        title="Add weight"
        name="Glute bridge"
        targetWord="12 reps"
        unit="lb"
        start={0}
        onUse={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.queryByText(/tap|type|enter a/i)).toBeNull();
  });
});

describe('WeightSheet — the subtitle', () => {
  it('drops the separator when the move has no number of its own', () => {
    render(
      <WeightSheet
        title="Add weight"
        name="Plank"
        targetWord=""
        unit="lb"
        start={0}
        onUse={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText('PLANK')).toBeInTheDocument();
    expect(screen.queryByText(/PLANK ·/)).toBeNull();
  });
});
