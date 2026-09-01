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

  /** A failed entry used to close the sheet like a success (PLAN-CHANGES.md Phase 0): now the
   *  parent keeps it open with an error line, so the button must come back to life for the retry. */
  it('failure keeps the sheet usable — the line shows and the button revives', async () => {
    const onEnter = vi.fn().mockResolvedValue(undefined); // the parent resolves, then hands back `error`
    const { rerender } = render(<DetourSetup onEnter={onEnter} onCancel={vi.fn()} />);
    await act(async () => screen.getByText('Unwell').click());
    await act(async () => screen.getByText('Start the detour').click());

    rerender(<DetourSetup onEnter={onEnter} onCancel={vi.fn()} error="That didn't take — try again in a moment." />);
    expect(screen.getByRole('alert').textContent).toMatch(/didn't take/);
    const go = screen.getByText('Start the detour') as HTMLButtonElement;
    expect(go.disabled).toBe(false);
  });
});
