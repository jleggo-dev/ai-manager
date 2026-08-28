import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MinutesStepper } from './MinutesStepper.tsx';

describe('MinutesStepper', () => {
  it('shows the current value', () => {
    render(<MinutesStepper value={32} onChange={vi.fn()} />);
    expect(screen.getByText('32 min')).toBeInTheDocument();
  });

  it('+ reports one more minute', () => {
    const onChange = vi.fn();
    render(<MinutesStepper value={32} onChange={onChange} />);
    screen.getByLabelText('More minutes').click();
    expect(onChange).toHaveBeenCalledWith(33);
  });

  it('- reports one fewer minute', () => {
    const onChange = vi.fn();
    render(<MinutesStepper value={32} onChange={onChange} />);
    screen.getByLabelText('Fewer minutes').click();
    expect(onChange).toHaveBeenCalledWith(31);
  });

  it('floors at 1 by default and disables further decrements', () => {
    const onChange = vi.fn();
    render(<MinutesStepper value={1} onChange={onChange} />);
    const fewer = screen.getByLabelText('Fewer minutes');
    expect(fewer).toBeDisabled();
    fewer.click();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('never reports below a custom floor', () => {
    const onChange = vi.fn();
    render(<MinutesStepper value={5} onChange={onChange} min={5} />);
    expect(screen.getByLabelText('Fewer minutes')).toBeDisabled();
  });
});
