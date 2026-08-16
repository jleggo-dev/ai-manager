import { render, screen } from '@testing-library/react';
import type { CoachPicks } from '@cadence/shared';
import { QuickPicks } from './QuickPicks.tsx';

/**
 * That the derived shape actually reaches the screen.
 *
 * `derivePickLayout` is unit-tested next door; what this guards is the wiring, because the way
 * this breaks is silently — the deriver returns the right answer and nobody asks it. The two
 * shapes are told apart by something a user can see: the grid draws the hint line under each
 * value, the rows do not.
 */
const HINT = 'most people keep this';

const picks = (options: CoachPicks['options']): CoachPicks => ({ multi: false, options });

describe('QuickPicks', () => {
  it('draws a scalar set as the grid, hint lines and all', () => {
    render(
      <QuickPicks
        picks={picks([
          { label: '10', hint: 'a short one' },
          { label: '20', hint: HINT },
        ])}
        onCompose={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /20/ })).toBeInTheDocument();
    expect(screen.getByText(HINT)).toBeInTheDocument();
  });

  it('draws a labelled set as rows, where a hint has nowhere to go', () => {
    render(
      <QuickPicks picks={picks([{ label: 'Mornings', hint: HINT }, { label: 'Evenings' }])} onCompose={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Mornings' })).toBeInTheDocument();
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });
});
