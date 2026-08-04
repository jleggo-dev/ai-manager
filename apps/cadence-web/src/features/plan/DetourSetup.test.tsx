import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { DetourSetup } from './DetourSetup.tsx';

describe('the detour check-in collects what a re-plan needs', () => {
  it('asks nothing until a type is chosen, then asks the two that matter', async () => {
    render(<DetourSetup onEnter={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByText('How long, roughly?')).toBeNull();
    await act(async () => screen.getByText('Traveling').click());
    expect(screen.getByText('How long, roughly?')).toBeTruthy();
    expect(screen.getByText('What have you got with you?')).toBeTruthy();
  });

  it('sends the window and the gear, not just the type', async () => {
    const onEnter = vi.fn();
    render(<DetourSetup onEnter={onEnter} onCancel={vi.fn()} />);
    await act(async () => screen.getByText('Traveling').click());
    await act(async () => screen.getByText('A few days').click());
    await act(async () => screen.getByText('Hotel gym').click());
    await act(async () => screen.getByText('Dumbbells').click());
    await act(async () => screen.getByText('Start the detour').click());
    expect(onEnter).toHaveBeenCalledWith({
      type: 'travel',
      days: 3,
      available_equipment: [{ name: 'Hotel gym' }, { name: 'Dumbbells' }],
    });
  });

  it('treats no gear as a real answer, never a blocker', async () => {
    const onEnter = vi.fn();
    render(<DetourSetup onEnter={onEnter} onCancel={vi.fn()} />);
    await act(async () => screen.getByText('Unwell').click());
    await act(async () => screen.getByText('Start the detour').click());
    expect(onEnter).toHaveBeenCalledWith({ type: 'illness', days: 7, available_equipment: [] });
  });
});
