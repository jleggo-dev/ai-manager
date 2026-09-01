/**
 * StepFeelingLog.test.tsx presses family → word → room → Save all the way through and checks the
 * acknowledgement renders, but never presses the "Close" button that acknowledgement screen shows —
 * `onDone` (the step's own hand-off contract, distinct from `onLog`) was never pressed or asserted.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { StepFeelingLog } from './StepFeelingLog.tsx';

describe('StepFeelingLog — Close on the acknowledgement screen', () => {
  it('pressing Close after saving calls onDone', () => {
    const onDone = vi.fn();
    render(<StepFeelingLog onLog={() => {}} onDone={onDone} />);

    fireEvent.click(screen.getByText('Settled'));
    fireEvent.click(screen.getByText('steady'));
    fireEvent.click(screen.getByText('here'));
    fireEvent.click(screen.getByText('Save'));

    expect(onDone).not.toHaveBeenCalled(); // Save alone must not already hand off.
    fireEvent.click(screen.getByText('Close'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
