import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useWeekReview } from './useWeekReview.ts';

const getWeekReviewFacts = vi.fn();
vi.mock('../../../lib/api.ts', () => ({ getWeekReviewFacts: (...a: unknown[]) => getWeekReviewFacts(...a) }));

const REVIEW = { from: '2026-08-17', to: '2026-08-23', built_at: '2026-08-24T09:00:00.000Z' };
const FACTS = { period: { from: REVIEW.from, to: REVIEW.to }, days: [], weigh_in: null };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useWeekReview', () => {
  it('starts loading, then settles to ready with the review and its facts', async () => {
    getWeekReviewFacts.mockResolvedValue({ review: REVIEW, facts: FACTS });
    const { result } = renderHook(() => useWeekReview());

    expect(result.current.state).toBe('loading');
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.review).toEqual(REVIEW);
    expect(result.current.facts).toEqual(FACTS);
  });

  it('settles to unavailable, not an error thrown, when the server has nothing pending', async () => {
    getWeekReviewFacts.mockResolvedValue(null);
    const { result } = renderHook(() => useWeekReview());
    await waitFor(() => expect(result.current.state).toBe('unavailable'));
    expect(result.current.facts).toBeNull();
  });

  it('settles to the same unavailable state when the fetch rejects outright', async () => {
    getWeekReviewFacts.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useWeekReview());
    await waitFor(() => expect(result.current.state).toBe('unavailable'));
  });
});
