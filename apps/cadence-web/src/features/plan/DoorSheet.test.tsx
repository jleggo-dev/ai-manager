import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DoorSheet } from './DoorSheet.tsx';

/** The door asks which fix it is — a temporary plan or a tweak — instead of assuming a detour. */
describe('the fork behind the door', () => {
  it('offers both fixes and routes each to its own flow', () => {
    const onTempPlan = vi.fn();
    const onAdjust = vi.fn();
    render(<DoorSheet onTempPlan={onTempPlan} onAdjust={onAdjust} onClose={vi.fn()} />);
    screen.getByText('New temporary plan').click();
    expect(onTempPlan).toHaveBeenCalledTimes(1);
    screen.getByText('Adjust my plan').click();
    expect(onAdjust).toHaveBeenCalledTimes(1);
  });

  it('the temporary-plan choice says the promise: pauses, never resets', () => {
    render(<DoorSheet onTempPlan={vi.fn()} onAdjust={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/pauses, never resets/)).toBeTruthy();
  });

  it('Cancel closes without choosing either', () => {
    const onTempPlan = vi.fn();
    const onAdjust = vi.fn();
    const onClose = vi.fn();
    render(<DoorSheet onTempPlan={onTempPlan} onAdjust={onAdjust} onClose={onClose} />);
    screen.getByText('Cancel').click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onTempPlan).not.toHaveBeenCalled();
    expect(onAdjust).not.toHaveBeenCalled();
  });
});
