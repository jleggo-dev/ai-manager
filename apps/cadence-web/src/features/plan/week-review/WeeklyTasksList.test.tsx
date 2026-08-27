import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { WeekReviewFacts } from '../../../lib/api.ts';
import { WeeklyTasksList } from './WeeklyTasksList.tsx';

const BASE: WeekReviewFacts = { period: { from: '2026-08-17', to: '2026-08-23' }, days: [], weigh_in: null };

describe('WeeklyTasksList', () => {
  it("renders the section label and the week's weigh-in", () => {
    const facts: WeekReviewFacts = {
      ...BASE,
      weigh_in: { occurrence_id: 'w1', date: '2026-08-23', status: 'pending' },
    };
    render(<WeeklyTasksList facts={facts} onToggleWeighIn={vi.fn()} />);
    expect(screen.getByText('WEEKLY TASKS')).toBeInTheDocument();
    expect(screen.getByText('Weigh-in')).toBeInTheDocument();
  });

  it('marks a done weigh-in visibly', () => {
    const facts: WeekReviewFacts = { ...BASE, weigh_in: { occurrence_id: 'w1', date: '2026-08-23', status: 'done' } };
    render(<WeeklyTasksList facts={facts} onToggleWeighIn={vi.fn()} />);
    expect(screen.getByText('✓')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('is LIVE (check-in rebuild, step 5): tapping the row reports the new state', () => {
    const onToggleWeighIn = vi.fn();
    const facts: WeekReviewFacts = {
      ...BASE,
      weigh_in: { occurrence_id: 'w1', date: '2026-08-23', status: 'pending' },
    };
    render(<WeeklyTasksList facts={facts} onToggleWeighIn={onToggleWeighIn} />);

    screen.getByLabelText(/Weigh-in/).click();

    expect(onToggleWeighIn).toHaveBeenCalledWith(true);
  });

  it('un-checking a done weigh-in reports false', () => {
    const onToggleWeighIn = vi.fn();
    const facts: WeekReviewFacts = { ...BASE, weigh_in: { occurrence_id: 'w1', date: '2026-08-23', status: 'done' } };
    render(<WeeklyTasksList facts={facts} onToggleWeighIn={onToggleWeighIn} />);

    screen.getByRole('checkbox').click();

    expect(onToggleWeighIn).toHaveBeenCalledWith(false);
  });

  it('shows nothing to confirm — not a false row — when no weigh-in is scheduled this week', () => {
    render(<WeeklyTasksList facts={BASE} onToggleWeighIn={vi.fn()} />);
    expect(screen.queryByText('Weigh-in')).not.toBeInTheDocument();
    expect(screen.getByText(/No weigh-in on the books/)).toBeInTheDocument();
  });
});
