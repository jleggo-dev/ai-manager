import { render, screen, fireEvent, within } from '@testing-library/react';
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

  it('draws no line explaining the buttons (owner ruling 2026-11-03: no text that covers for the UI)', () => {
    render(<Walkthrough walkthrough={wt} title="Easy run" onClose={() => {}} onComplete={() => {}} />);
    expect(screen.queryByText(/Back and Next only/)).toBeNull();
    expect(screen.queryByText(/nothing is logged/)).toBeNull();
    fireEvent.click(screen.getByText('All steps'));
    expect(screen.queryByText(/Looking around changes nothing/)).toBeNull();
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

/** Three steps so the shell can be scrolled on a middle step and then moved on. */
const threeWt: WalkthroughData = {
  total_min: 9,
  steps: [
    { id: 's1', title: 'Warm up', minutes: 3, tool: { kind: 'read' }, skippable: true },
    { id: 's2', title: 'Long read', body: 'A long cue.', minutes: 3, tool: { kind: 'read' }, skippable: true },
    { id: 's3', title: 'Cool down', minutes: 3, tool: { kind: 'read' }, skippable: true },
  ],
};

describe('Walkthrough — every step opens at the top', () => {
  const scroller = (container: HTMLElement) => container.querySelector<HTMLDivElement>('[data-step-body]')!;

  it('a step reached from one scrolled to the bottom starts at the top (Next, Back, and a pip)', () => {
    const { container } = render(
      <Walkthrough walkthrough={threeWt} title="Easy run" onClose={() => {}} onComplete={() => {}} />,
    );
    fireEvent.click(screen.getByLabelText('Next step')); // step 2
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    scroller(container).scrollTop = 300;

    fireEvent.click(screen.getByLabelText('Next step')); // step 3
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();
    expect(scroller(container).scrollTop).toBe(0);

    scroller(container).scrollTop = 120;
    fireEvent.click(screen.getByLabelText('Previous step')); // back to step 2
    expect(scroller(container).scrollTop).toBe(0);

    scroller(container).scrollTop = 80;
    fireEvent.click(screen.getByText('All steps'));
    fireEvent.click(screen.getByText('Warm up')); // jump to step 1 from the sheet
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    expect(scroller(container).scrollTop).toBe(0);
  });

  it('scrolling within a step is left alone', () => {
    const { container } = render(
      <Walkthrough walkthrough={threeWt} title="Easy run" onClose={() => {}} onComplete={() => {}} />,
    );
    scroller(container).scrollTop = 300;
    fireEvent.click(screen.getByText('All steps'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'All steps' })).getByText('Warm up')); // same step, sheet closed
    expect(screen.queryByRole('dialog', { name: 'All steps' })).toBeNull();
    expect(scroller(container).scrollTop).toBe(300);
  });
});

/** A timer with two or more sets is dispatched to the timed-sets player (walkthrough v3 R1); a
 *  single hold is still the plain timer. The shell's switch is the router here, so both sides. */
const carryWt: WalkthroughData = {
  total_min: 4,
  steps: [
    {
      id: 's1',
      title: 'Farmer carry',
      minutes: 3,
      tool: { kind: 'timer', seconds: 45, sets: 4, load: '2×40 lb' },
      skippable: true,
    },
    { id: 's2', title: 'Plank', minutes: 1, tool: { kind: 'timer', seconds: 60 }, skippable: true },
  ],
};

describe('Walkthrough — a timer in sets plays as sets; a single hold does not', () => {
  it('the carry opens on set 1 with the target as plain text; the plank opens as the hold it always was', () => {
    render(<Walkthrough walkthrough={carryWt} title="Obstacle strength" onClose={() => {}} onComplete={() => {}} />);
    expect(screen.getByText('45 s × 2×40 lb · 4 sets')).toBeInTheDocument();
    expect(screen.getByText('Set 1 of 4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Next step'));
    expect(screen.getByText('1 min')).toBeInTheDocument();
    expect(screen.queryByText(/Set 1 of/)).toBeNull();
    expect(screen.getByRole('button', { name: /^Start · 1 min/ })).toBeInTheDocument();
  });
});
