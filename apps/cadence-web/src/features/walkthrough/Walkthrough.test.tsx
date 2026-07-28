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

describe('Walkthrough v2 — browse / do / commit', () => {
  it('moving never logs; a tool logs; Finish is the single commit', () => {
    const onComplete = vi.fn();
    render(<Walkthrough walkthrough={wt} title="Easy run" onClose={() => {}} onComplete={onComplete} />);

    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('Warm up')).toBeInTheDocument();

    // Next only moves you — nothing is committed by navigating.
    fireEvent.click(screen.getByLabelText('Next step'));
    expect(screen.getByText('Main effort')).toBeInTheDocument();

    // The tool is the only thing that logs.
    fireEvent.click(screen.getByText('Log this done'));

    // Past the last step → the Recap (nothing written to the log yet).
    fireEvent.click(screen.getByLabelText('Next step'));
    expect(screen.getByText(/Recap/i)).toBeInTheDocument();

    // Finish is the one write → celebration → Done reports the summary up.
    fireEvent.click(screen.getByText('Finish · +10 XP'));
    expect(screen.getByText('Nice work!')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Done'));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('reaching the end with nothing logged offers a no-op close, not a false finish', () => {
    const onComplete = vi.fn();
    render(<Walkthrough walkthrough={wt} title="Easy run" onClose={() => {}} onComplete={onComplete} />);
    fireEvent.click(screen.getByLabelText('Next step')); // step 2
    fireEvent.click(screen.getByLabelText('Next step')); // → recap, nothing logged
    expect(screen.getByText('Nothing logged yet.')).toBeInTheDocument();
    expect(screen.getByText('Close without logging')).toBeInTheDocument();
  });
});
