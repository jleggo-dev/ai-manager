import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { WeekReviewFacts } from '../../../lib/api.ts';
import { WeekReviewSheet } from './WeekReviewSheet.tsx';

const getWeekReviewFacts = vi.fn();
const dismissPendingWeekReview = vi.fn();
const confirmWeekReviewSession = vi.fn();
const toggleWeekReviewMeal = vi.fn();
const toggleWeekReviewMindStep = vi.fn();

vi.mock('../../../lib/api.ts', () => ({
  getWeekReviewFacts: (...a: unknown[]) => getWeekReviewFacts(...a),
  dismissPendingWeekReview: (...a: unknown[]) => dismissPendingWeekReview(...a),
  confirmWeekReviewSession: (...a: unknown[]) => confirmWeekReviewSession(...a),
  toggleWeekReviewMeal: (...a: unknown[]) => toggleWeekReviewMeal(...a),
  toggleWeekReviewMindStep: (...a: unknown[]) => toggleWeekReviewMindStep(...a),
}));

const REVIEW = { from: '2026-08-17', to: '2026-08-23', built_at: '2026-08-24T09:00:00.000Z' };

// Day 2 (2026-08-19) carries the one session, done. Day 4 (2026-08-21) has nothing logged at
// all — the toggle tests use it so a flip there is unambiguous.
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
// sessions: 1 of 1 done. meals: breakfast+lunch logged for i<4 (4 each), dinner for i<3 (3) = 11 of 21.
const ZERO_CORRECTIONS_RECEIPT = 'Week confirmed — 1 of 1 sessions · 11 of 21 meals · 0 corrections';

beforeEach(() => {
  vi.clearAllMocks();
  getWeekReviewFacts.mockResolvedValue({ review: REVIEW, facts: FACTS });
  dismissPendingWeekReview.mockResolvedValue(true);
  confirmWeekReviewSession.mockResolvedValue(true);
  toggleWeekReviewMeal.mockResolvedValue(true);
  toggleWeekReviewMindStep.mockResolvedValue(true);
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

  describe('the confirm footer (check-in rebuild, step 5)', () => {
    it('reads as the plain confirm before anything has changed', async () => {
      render(<WeekReviewSheet onClose={vi.fn()} />);
      await screen.findByText('DAY BY DAY');
      expect(screen.getByText('Confirm my week')).toBeInTheDocument();
      expect(screen.getByText('Nothing changed — confirms the week as logged.')).toBeInTheDocument();
    });

    it('updates the label and helper as a toggle diverges from the initial fetch', async () => {
      render(<WeekReviewSheet onClose={vi.fn()} />);
      await screen.findByText('DAY BY DAY');

      screen.getAllByRole('listitem')[4]!.click(); // 2026-08-21 — nothing logged that day
      await screen.findByText('← Back to the week');
      screen.getByLabelText('Breakfast').click();

      await waitFor(() => expect(screen.getByText('Confirm week · save 1 fix')).toBeInTheDocument());
      expect(
        screen.getByText('1 correction will be written to your log, then a summary goes to your coach.'),
      ).toBeInTheDocument();
    });

    it('shows a quiet inline error and reverts the toggle when a write fails', async () => {
      toggleWeekReviewMeal.mockResolvedValue(false);
      render(<WeekReviewSheet onClose={vi.fn()} />);
      await screen.findByText('DAY BY DAY');
      screen.getAllByRole('listitem')[4]!.click();
      await screen.findByText('← Back to the week');

      screen.getByLabelText('Breakfast').click();

      await waitFor(() => expect(screen.getByText("That didn't save — try again in a moment.")).toBeInTheDocument());
      expect(screen.getByLabelText('Breakfast')).not.toBeChecked();
      // Nothing landed, so the footer still reads the plain confirm.
      expect(screen.getByText('Confirm my week')).toBeInTheDocument();
    });

    it('tapping confirm dismisses the pointer, closes the sheet, and hands the coach the receipt', async () => {
      const onClose = vi.fn();
      const onConfirmed = vi.fn();
      render(<WeekReviewSheet onClose={onClose} onConfirmed={onConfirmed} />);
      await screen.findByText('Confirm my week');

      screen.getByText('Confirm my week').click();

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(dismissPendingWeekReview).toHaveBeenCalledTimes(1);
      expect(onConfirmed).toHaveBeenCalledWith(ZERO_CORRECTIONS_RECEIPT);
    });

    it('still closes and hands off the receipt even when the dismiss write fails', async () => {
      dismissPendingWeekReview.mockRejectedValue(new Error('db down'));
      const onClose = vi.fn();
      const onConfirmed = vi.fn();
      render(<WeekReviewSheet onClose={onClose} onConfirmed={onConfirmed} />);
      await screen.findByText('Confirm my week');

      screen.getByText('Confirm my week').click();

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(onConfirmed).toHaveBeenCalledWith(ZERO_CORRECTIONS_RECEIPT);
    });
  });
});
