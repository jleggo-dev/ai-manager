import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { WeekReviewFacts } from '../../../lib/api.ts';
import { WeekReviewSheet } from './WeekReviewSheet.tsx';

const getWeekReviewFacts = vi.fn();
vi.mock('../../../lib/api.ts', () => ({ getWeekReviewFacts: (...a: unknown[]) => getWeekReviewFacts(...a) }));

const REVIEW = { from: '2026-08-17', to: '2026-08-23', built_at: '2026-08-24T09:00:00.000Z' };

const FACTS: WeekReviewFacts = {
  period: { from: REVIEW.from, to: REVIEW.to },
  weigh_in: { occurrence_id: 'w1', date: '2026-08-23', status: 'pending' },
  days: Array.from({ length: 7 }, (_, i) => ({
    date: `2026-08-${17 + i}`,
    sessions: i === 2 ? [{ occurrence_id: `s${i}`, title: 'Easy run', status: 'done' as const }] : [],
    meals: [
      { meal: 'breakfast' as const, occurrence_id: `b${i}`, logged: i < 4 },
      { meal: 'lunch' as const, occurrence_id: `l${i}`, logged: i < 4 },
      { meal: 'dinner' as const, occurrence_id: `d${i}`, logged: i < 3 },
    ],
    mind: [],
  })),
};

beforeEach(() => {
  vi.clearAllMocks();
  getWeekReviewFacts.mockResolvedValue({ review: REVIEW, facts: FACTS });
});

describe('WeekReviewSheet', () => {
  it('renders the header, date range, and every panel once the fetch settles', async () => {
    render(<WeekReviewSheet onClose={vi.fn()} />);

    expect(await screen.findByText('Week review')).toBeInTheDocument();
    expect(screen.getByText('Aug 17–Aug 23')).toBeInTheDocument();
    expect(screen.getByText('WEEKLY TASKS')).toBeInTheDocument();
    expect(screen.getByText('Weigh-in')).toBeInTheDocument();
    expect(screen.getByText('DAY BY DAY')).toBeInTheDocument();
    expect(screen.getByText('Tap a day to check or fix its log')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(7); // the seven day chips
    expect(screen.getByText('MEALS')).toBeInTheDocument();
  });

  it('tapping a day chip drills in, showing that day and hiding the week list', async () => {
    render(<WeekReviewSheet onClose={vi.fn()} />);
    await screen.findByText('DAY BY DAY');

    screen.getAllByRole('listitem')[2]!.click(); // 2026-08-19, the day with the session

    expect(await screen.findByText('Easy run')).toBeInTheDocument();
    expect(screen.getByText('← Back to the week')).toBeInTheDocument();
    // The week-level view is gone while drilled in.
    expect(screen.queryByText('WEEKLY TASKS')).not.toBeInTheDocument();
    expect(screen.queryByText('DAY BY DAY')).not.toBeInTheDocument();
  });

  it('the back control returns to the week — day chips and rollups again, not the drill-in', async () => {
    render(<WeekReviewSheet onClose={vi.fn()} />);
    await screen.findByText('DAY BY DAY');
    screen.getAllByRole('listitem')[2]!.click();
    await screen.findByText('← Back to the week');

    screen.getByText('← Back to the week').click();

    expect(await screen.findByText('DAY BY DAY')).toBeInTheDocument();
    expect(screen.queryByText('← Back to the week')).not.toBeInTheDocument();
  });

  it('shows a shape, not fake numbers, while the one GET is in flight', () => {
    getWeekReviewFacts.mockReturnValue(new Promise(() => {})); // never resolves in this test
    render(<WeekReviewSheet onClose={vi.fn()} />);
    expect(screen.getByRole('status')).toBeInTheDocument(); // SkeletonScreen's aria-live label
    expect(screen.queryByText('WEEKLY TASKS')).not.toBeInTheDocument();
  });

  it('falls back to one warm message when there is nothing to review', async () => {
    getWeekReviewFacts.mockResolvedValue(null); // 404 (nothing pending) and any other failure alike
    render(<WeekReviewSheet onClose={vi.fn()} />);
    expect(await screen.findByText(/Nothing to review right now/)).toBeInTheDocument();
  });

  it('the close control reports back to the caller', async () => {
    const onClose = vi.fn();
    render(<WeekReviewSheet onClose={onClose} />);
    await screen.findByText('Week review');
    screen.getByRole('button', { name: 'Close' }).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('never claims MINDSET for a week with no mind/practice rows', async () => {
    render(<WeekReviewSheet onClose={vi.fn()} />);
    await screen.findByText('MEALS');
    expect(screen.queryByText('MINDSET')).not.toBeInTheDocument();
  });

  // Guards against a real regression risk: `getWeekReviewFacts` failing must not hang the sheet on
  // its skeleton forever — see useWeekReview.ts's own `.catch`.
  it('settles to the same fallback when the fetch rejects outright', async () => {
    getWeekReviewFacts.mockRejectedValue(new Error('network down'));
    render(<WeekReviewSheet onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Nothing to review right now/)).toBeInTheDocument());
  });
});
