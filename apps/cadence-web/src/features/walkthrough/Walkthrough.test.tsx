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

/** A one-step measure walkthrough — end-to-end proof the shell dispatches `measure` to its own
 *  renderer (Walkthrough.tsx's switch) rather than falling through to the checkoff default, which
 *  is what happened before this parcel wired the case in. */
const measureWt: WalkthroughData = {
  total_min: 1,
  steps: [
    {
      id: 's1',
      title: 'Weigh in',
      minutes: 1,
      tool: { kind: 'measure', metric: 'Weight', unit: 'kg' },
      skippable: true,
    },
  ],
};

describe('Walkthrough — measure step end to end', () => {
  it('renders the number entry (not a plain checkoff button), logs it, and the recap shows it verbatim', () => {
    render(<Walkthrough walkthrough={measureWt} title="Weigh-in" onClose={() => {}} onComplete={() => {}} />);

    expect(screen.getByText('Weight')).toBeInTheDocument();
    expect(screen.queryByText('Log this done')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Weight'), { target: { value: '82.4' } });
    fireEvent.click(screen.getByText('Log this'));

    fireEvent.click(screen.getByLabelText('Next step')); // → recap
    expect(screen.getByText('82.4 kg')).toBeInTheDocument();
  });
});
