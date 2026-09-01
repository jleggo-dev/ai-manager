import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { StepMeasure } from './StepMeasure.tsx';

describe('StepMeasure — a number, verbatim', () => {
  it('shows the metric label and unit from the step params', () => {
    render(<StepMeasure metric="Weight" unit="kg" onLog={() => {}} />);
    expect(screen.getByText('Weight')).toBeInTheDocument();
    expect(screen.getByText('kg')).toBeInTheDocument();
  });

  it('degrades honestly: an absent unit shows no unit label at all', () => {
    render(<StepMeasure metric="Wingspan" unit="" onLog={() => {}} />);
    expect(screen.queryByText('kg')).not.toBeInTheDocument();
  });

  it('the Log button stays disabled until a valid number is entered', () => {
    render(<StepMeasure metric="Weight" unit="kg" onLog={() => {}} />);
    const btn = screen.getByText('Log this');
    expect(btn).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Weight'), { target: { value: 'not a number' } });
    expect(screen.getByText('Log this')).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Weight'), { target: { value: '82.4' } });
    expect(screen.getByText('Log this')).not.toBeDisabled();
  });

  it('logs the number EXACTLY as typed — never reparsed or rounded', () => {
    const onLog = vi.fn();
    render(<StepMeasure metric="Weight" unit="kg" onLog={onLog} />);
    fireEvent.change(screen.getByLabelText('Weight'), { target: { value: '82.40' } });
    fireEvent.click(screen.getByText('Log this'));
    expect(onLog).toHaveBeenCalledWith({ kind: 'measure', value: '82.40', unit: 'kg', metric: 'Weight' });
  });

  it('once logged, shows the receipt and disables further entry', () => {
    const log = { kind: 'measure' as const, value: '5.2', unit: 'km', metric: 'Distance' };
    render(<StepMeasure metric="Distance" unit="km" log={log} onLog={() => {}} />);
    expect(screen.getByText('✓ Logged · 5.2 km')).toBeInTheDocument();
    expect(screen.getByLabelText('Distance')).toBeDisabled();
  });
});
