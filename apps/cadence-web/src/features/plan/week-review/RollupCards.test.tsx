import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { WeekReviewFacts } from '../../../lib/api.ts';
import { RollupCards } from './RollupCards.tsx';

function facts(over: Partial<WeekReviewFacts['days'][number]>[] = []): WeekReviewFacts {
  return {
    period: { from: '2026-08-17', to: '2026-08-23' },
    weigh_in: null,
    days: over.map((d, i) => ({
      date: `2026-08-${17 + i}`,
      sessions: [],
      meals: [
        { meal: 'breakfast', occurrence_id: null, logged: false },
        { meal: 'lunch', occurrence_id: null, logged: false },
        { meal: 'dinner', occurrence_id: null, logged: false },
      ],
      mind: [],
      ...d,
    })),
  };
}

describe('RollupCards', () => {
  it('renders MEALS and SESSIONS as kept/total, "17 of 21" style — never "missed"', () => {
    const week = facts(
      Array.from({ length: 7 }, (_, i) => ({
        meals: [
          { meal: 'breakfast' as const, occurrence_id: `b${i}`, logged: i < 6 },
          { meal: 'lunch' as const, occurrence_id: `l${i}`, logged: i < 6 },
          { meal: 'dinner' as const, occurrence_id: `d${i}`, logged: i < 5 },
        ],
        // 5 of the 7 days schedule one session; 3 of those 5 are done — kept 3, total 5.
        sessions:
          i < 5
            ? [{ occurrence_id: `s${i}`, title: 'Easy run', status: i < 3 ? ('done' as const) : ('missed' as const) }]
            : [],
      })),
    );
    render(<RollupCards facts={week} />);

    expect(screen.getByText('MEALS')).toBeInTheDocument();
    expect(screen.getByText('17/21')).toBeInTheDocument();
    expect(screen.getByText('SESSIONS')).toBeInTheDocument();
    expect(screen.getByText('3/5')).toBeInTheDocument();
    expect(screen.queryByText(/missed/i)).not.toBeInTheDocument();
  });

  it('omits the MINDSET card entirely for a week with no mind/practice rows', () => {
    const week = facts([{}, {}]);
    render(<RollupCards facts={week} />);
    expect(screen.queryByText('MINDSET')).not.toBeInTheDocument();
  });

  it('shows MINDSET once the week has any mind/practice rows', () => {
    const week = facts([
      { mind: [{ occurrence_id: 'g1', title: 'Sit', status: 'done', done: true }] },
      { mind: [{ occurrence_id: 'g2', title: 'Sit', status: 'pending', done: false }] },
    ]);
    render(<RollupCards facts={week} />);
    expect(screen.getByText('MINDSET')).toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });
});
