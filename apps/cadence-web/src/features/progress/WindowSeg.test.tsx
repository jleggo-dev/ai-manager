import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WindowSeg } from './WindowSeg.tsx';

describe('WindowSeg', () => {
  it('marks the current value as pressed and the others not', () => {
    render(<WindowSeg value="month" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Month' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onChange with the clicked window — a purely controlled component', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<WindowSeg value="week" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(onChange).toHaveBeenCalledWith('all');
  });

  it('does not change its own displayed value — the caller owns state (controlled, no internal fetch)', async () => {
    const user = userEvent.setup();
    render(<WindowSeg value="week" onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Month' }));
    // Still "week" pressed: WindowSeg never mutates its own display — only the parent re-render would.
    expect(screen.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true');
  });
});
