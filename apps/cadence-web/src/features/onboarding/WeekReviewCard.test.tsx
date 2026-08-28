/**
 * WeekReviewCard follows ChangeCard's contract: it asks the SERVER what is pending and draws
 * nothing when the answer is nothing, so mounting it unconditionally beside every finished turn
 * is safe. `open_week_review` writes a pointer, never a tag — these pin that the card is the
 * pointer's, not the turn's prose.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  getPendingWeekReview: vi.fn(),
  dismissPendingWeekReview: vi.fn(async () => true),
}));
vi.mock('../../lib/api.ts', () => api);

const { WeekReviewCard } = await import('./WeekReviewCard.tsx');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('WeekReviewCard', () => {
  it('renders nothing while nothing is pending', async () => {
    api.getPendingWeekReview.mockResolvedValueOnce(null);
    const { container } = render(<WeekReviewCard />);

    // Nothing to await for text; give the fetch a tick and confirm the frame stays empty.
    await waitFor(() => expect(api.getPendingWeekReview).toHaveBeenCalledTimes(1));
    expect(container.querySelector('.chg-t')).toBeNull();
  });

  it('shows the labelled card with the week it covers, once one is pending', async () => {
    api.getPendingWeekReview.mockResolvedValueOnce({
      from: '2026-08-16',
      to: '2026-08-22',
      built_at: '2026-08-23T09:00:00.000Z',
    });
    render(<WeekReviewCard />);

    expect(await screen.findByText('Week review')).toBeInTheDocument();
    expect(screen.getByText(/built from your log/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
  });

  it('calls onOpen when tapped, and does not fetch again', async () => {
    api.getPendingWeekReview.mockResolvedValueOnce({
      from: '2026-08-16',
      to: '2026-08-22',
      built_at: '2026-08-23T09:00:00.000Z',
    });
    const onOpen = vi.fn();
    render(<WeekReviewCard onOpen={onOpen} />);

    (await screen.findByRole('button', { name: 'Open' })).click();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(api.getPendingWeekReview).toHaveBeenCalledTimes(1);
  });

  it('dismisses on "Not now" and disappears without opening', async () => {
    api.getPendingWeekReview.mockResolvedValueOnce({
      from: '2026-08-16',
      to: '2026-08-22',
      built_at: '2026-08-23T09:00:00.000Z',
    });
    const onOpen = vi.fn();
    render(<WeekReviewCard onOpen={onOpen} />);

    (await screen.findByRole('button', { name: 'Not now' })).click();
    await waitFor(() => expect(api.dismissPendingWeekReview).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Week review')).not.toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('stays quiet when the read fails — a missing card is not a broken turn', async () => {
    api.getPendingWeekReview.mockRejectedValueOnce(new Error('500'));
    const { container } = render(<WeekReviewCard />);

    await waitFor(() => expect(api.getPendingWeekReview).toHaveBeenCalledTimes(1));
    expect(container.querySelector('.chg-t')).toBeNull();
  });
});
