import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { Walkthrough as WalkthroughData } from '@cadence/shared';
import { Walkthrough } from './Walkthrough.tsx';

const wt: WalkthroughData = {
  total_min: 8,
  steps: [
    { id: 's1', title: 'Warm up', body: 'Ease in.', minutes: 3, tool: { kind: 'read' }, skippable: true },
    { id: 's2', title: 'Main effort', minutes: 5, tool: { kind: 'checkoff' }, skippable: true, core: true },
  ],
};

describe('Walkthrough', () => {
  it('plays step by step, reaches a celebration, and reports completion', () => {
    const onComplete = vi.fn();
    render(<Walkthrough walkthrough={wt} title="Easy run" onClose={() => {}} onComplete={onComplete} />);

    // Step 1
    expect(screen.getByText('STEP 1 OF 2')).toBeInTheDocument();
    expect(screen.getByText('Warm up')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Next'));

    // Step 2 — last step shows Finish
    expect(screen.getByText('Main effort')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Finish'));

    // Celebration → Continue reports completion
    expect(screen.getByText('Nice work!')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Continue'));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('lets a step be skipped', () => {
    const onComplete = vi.fn();
    render(<Walkthrough walkthrough={wt} title="Easy run" onClose={() => {}} onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Skip')); // skip step 1
    expect(screen.getByText('Main effort')).toBeInTheDocument();
  });
});
