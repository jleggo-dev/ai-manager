import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { WeekReviewDay } from '../../../lib/api.ts';
import { DayChips } from './DayChips.tsx';

function week(): WeekReviewDay[] {
  return Array.from({ length: 7 }, (_, i) => ({
    date: `2026-08-${String(17 + i).padStart(2, '0')}`,
    sessions: i === 0 ? [{ occurrence_id: `s${i}`, title: 'Easy run', status: 'done' as const }] : [],
    meals: [
      { meal: 'breakfast' as const, occurrence_id: `m${i}b`, logged: i < 3 },
      { meal: 'lunch' as const, occurrence_id: `m${i}l`, logged: false },
      { meal: 'dinner' as const, occurrence_id: `m${i}d`, logged: false },
    ],
    mind: [],
  }));
}

describe('DayChips', () => {
  it('renders one chip per day in the window', () => {
    render(<DayChips days={week()} onSelect={vi.fn()} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
  });

  it('reports what was kept in the chip label, never "missed"', () => {
    render(<DayChips days={week()} onSelect={vi.fn()} />);
    // Day 0: 1 session done + 1 meal logged, of 1 session + 3 meals = 2 of 4.
    expect(screen.getByLabelText(/2 of 4 kept/)).toBeInTheDocument();
    expect(screen.queryByText(/missed/i)).not.toBeInTheDocument();
  });

  it("tapping a chip reports that day's date, and nothing else", () => {
    const onSelect = vi.fn();
    render(<DayChips days={week()} onSelect={onSelect} />);
    screen.getAllByRole('listitem')[3]!.click();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('2026-08-20');
  });

  it('a day with nothing scheduled still renders — an empty ring, not a missing chip', () => {
    const restDay: WeekReviewDay = { date: '2026-08-24', sessions: [], meals: [], mind: [] };
    render(<DayChips days={[restDay]} onSelect={vi.fn()} />);
    expect(screen.getByLabelText(/0 of 0 kept/)).toBeInTheDocument();
  });
});
