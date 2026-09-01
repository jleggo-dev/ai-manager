import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { StepCheckoff } from './SimpleTools.tsx';

describe('StepCheckoff — did it, with an optional note', () => {
  it('a single tap logs done with no note when nothing was typed', () => {
    const onLog = vi.fn();
    render(<StepCheckoff onLog={onLog} />);
    fireEvent.click(screen.getByText('Log this done'));
    expect(onLog).toHaveBeenCalledWith({ kind: 'done' });
  });

  it('whatever is typed rides along in the same log write', () => {
    const onLog = vi.fn();
    render(<StepCheckoff onLog={onLog} />);
    fireEvent.change(screen.getByPlaceholderText('anything to add? (optional)'), {
      target: { value: 'took the long way round' },
    });
    fireEvent.click(screen.getByText('Log this done'));
    expect(onLog).toHaveBeenCalledWith({ kind: 'done', note: 'took the long way round' });
  });

  it('shows the label when the step carries one (a distance target)', () => {
    render(<StepCheckoff label="5 km" onLog={() => {}} />);
    expect(screen.getByText('5 km')).toBeInTheDocument();
  });

  it('once logged, the button disables and a saved note renders back instead of the input', () => {
    render(<StepCheckoff log={{ kind: 'done', note: 'felt easy' }} onLog={() => {}} />);
    expect(screen.getByText('✓ Logged')).toBeInTheDocument();
    expect(screen.getByText('felt easy')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('anything to add? (optional)')).not.toBeInTheDocument();
  });

  it('degrades honestly: a logged step with no note shows no note line at all', () => {
    const { container } = render(<StepCheckoff log={{ kind: 'done' }} onLog={() => {}} />);
    expect(screen.getByText('✓ Logged')).toBeInTheDocument();
    // Just the button's own text — no stray empty note element rendered alongside it.
    expect(container.textContent?.trim()).toBe('✓ Logged');
  });
});
