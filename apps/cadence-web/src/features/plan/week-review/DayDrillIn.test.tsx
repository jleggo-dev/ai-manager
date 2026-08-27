import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { WeekReviewDay } from '../../../lib/api.ts';
import { DayDrillIn } from './DayDrillIn.tsx';

describe('DayDrillIn', () => {
  it('renders sessions, meals and named mind steps for the day, all inert', () => {
    const day: WeekReviewDay = {
      date: '2026-08-17',
      sessions: [{ occurrence_id: 's1', title: 'Easy run', status: 'done', planned_min: 40, logged_min: 45 }],
      meals: [
        { meal: 'breakfast', occurrence_id: 'm1', logged: true },
        { meal: 'lunch', occurrence_id: 'm2', logged: false },
        { meal: 'dinner', occurrence_id: null, logged: false },
      ],
      mind: [
        {
          occurrence_id: 'g1',
          title: 'Evening pages',
          status: 'pending',
          steps: [
            { name: 'Settle', done: true },
            { name: 'Write', done: false },
          ],
        },
      ],
    };
    render(<DayDrillIn day={day} onBack={vi.fn()} />);

    expect(screen.getByText('Easy run')).toBeInTheDocument();
    expect(screen.getByText('45 min')).toBeInTheDocument(); // logged wins over planned
    expect(screen.getByText('Breakfast')).toBeInTheDocument();
    expect(screen.getByText('Lunch')).toBeInTheDocument();
    expect(screen.getByText('Dinner')).toBeInTheDocument();
    expect(screen.getByText('Evening pages')).toBeInTheDocument();
    expect(screen.getByText('Settle')).toBeInTheDocument();
    expect(screen.getByText('Write')).toBeInTheDocument();

    // Read-only this step: every checkbox present, all disabled.
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) expect(box).toBeDisabled();
  });

  it('a mind row with no named steps falls back to a single done/not-done row', () => {
    const day: WeekReviewDay = {
      date: '2026-08-17',
      sessions: [],
      meals: [
        { meal: 'breakfast', occurrence_id: null, logged: false },
        { meal: 'lunch', occurrence_id: null, logged: false },
        { meal: 'dinner', occurrence_id: null, logged: false },
      ],
      mind: [{ occurrence_id: 'g1', title: 'Sit', status: 'done', done: true }],
    };
    render(<DayDrillIn day={day} onBack={vi.fn()} />);
    expect(screen.getByText('Sit')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(4); // 3 meals + the one mind row
  });

  it('shows a plain empty message for a day with nothing scheduled', () => {
    const day: WeekReviewDay = {
      date: '2026-08-24',
      sessions: [],
      meals: [
        { meal: 'breakfast', occurrence_id: null, logged: false },
        { meal: 'lunch', occurrence_id: null, logged: false },
        { meal: 'dinner', occurrence_id: null, logged: false },
      ],
      mind: [],
    };
    render(<DayDrillIn day={day} onBack={vi.fn()} />);
    expect(screen.getByText('Nothing scheduled this day.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('the back control reports back to the caller', () => {
    const onBack = vi.fn();
    const day: WeekReviewDay = {
      date: '2026-08-17',
      sessions: [],
      meals: [
        { meal: 'breakfast', occurrence_id: null, logged: false },
        { meal: 'lunch', occurrence_id: null, logged: false },
        { meal: 'dinner', occurrence_id: null, logged: false },
      ],
      mind: [],
    };
    render(<DayDrillIn day={day} onBack={onBack} />);
    screen.getByText('← Back to the week').click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
