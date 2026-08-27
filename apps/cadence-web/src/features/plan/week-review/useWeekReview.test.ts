import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { WeekReviewFacts } from '../../../lib/api.ts';
import { useWeekReview } from './useWeekReview.ts';

const getWeekReviewFacts = vi.fn();
const confirmWeekReviewSession = vi.fn();
const toggleWeekReviewMeal = vi.fn();
const toggleWeekReviewMindStep = vi.fn();

vi.mock('../../../lib/api.ts', () => ({
  getWeekReviewFacts: (...a: unknown[]) => getWeekReviewFacts(...a),
  confirmWeekReviewSession: (...a: unknown[]) => confirmWeekReviewSession(...a),
  toggleWeekReviewMeal: (...a: unknown[]) => toggleWeekReviewMeal(...a),
  toggleWeekReviewMindStep: (...a: unknown[]) => toggleWeekReviewMindStep(...a),
}));

const REVIEW = { from: '2026-08-17', to: '2026-08-23', built_at: '2026-08-24T09:00:00.000Z' };

const FACTS: WeekReviewFacts = {
  period: { from: REVIEW.from, to: REVIEW.to },
  weigh_in: { occurrence_id: 'w1', date: '2026-08-23', status: 'pending' },
  days: [
    {
      date: '2026-08-17',
      sessions: [{ occurrence_id: 's1', title: 'Easy run', status: 'pending' }],
      meals: [
        { meal: 'breakfast', occurrence_id: 'b1', logged: false },
        { meal: 'lunch', occurrence_id: 'l1', logged: false },
        { meal: 'dinner', occurrence_id: 'd1', logged: false },
      ],
      mind: [{ occurrence_id: 'g1', title: 'Pages', status: 'pending', steps: [{ name: 'Write', done: false }] }],
    },
  ],
};

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
    expect(result.current.initialFacts).toEqual(FACTS);
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

  describe('toggleSession', () => {
    it('applies optimistically, writes through, and never touches initialFacts', async () => {
      getWeekReviewFacts.mockResolvedValue({ review: REVIEW, facts: FACTS });
      confirmWeekReviewSession.mockResolvedValue(true);
      const { result } = renderHook(() => useWeekReview());
      await waitFor(() => expect(result.current.state).toBe('ready'));

      await act(() => result.current.toggleSession('s1', true, 32));

      expect(result.current.facts!.days[0]!.sessions[0]).toMatchObject({ status: 'done', logged_min: 32 });
      expect(result.current.initialFacts!.days[0]!.sessions[0]!.status).toBe('pending');
      expect(confirmWeekReviewSession).toHaveBeenCalledWith('s1', true, 32);
      expect(result.current.writeError).toBeNull();
    });

    it('reverts the toggle and reports a quiet error when the write comes back false', async () => {
      getWeekReviewFacts.mockResolvedValue({ review: REVIEW, facts: FACTS });
      confirmWeekReviewSession.mockResolvedValue(false);
      const { result } = renderHook(() => useWeekReview());
      await waitFor(() => expect(result.current.state).toBe('ready'));

      await act(() => result.current.toggleSession('s1', true));

      expect(result.current.facts!.days[0]!.sessions[0]!.status).toBe('pending');
      expect(result.current.writeError).toBe("That didn't save — try again in a moment.");
    });

    it('reverts the same way when the write throws', async () => {
      getWeekReviewFacts.mockResolvedValue({ review: REVIEW, facts: FACTS });
      confirmWeekReviewSession.mockRejectedValue(new Error('network down'));
      const { result } = renderHook(() => useWeekReview());
      await waitFor(() => expect(result.current.state).toBe('ready'));

      await act(() => result.current.toggleSession('s1', true));

      expect(result.current.facts!.days[0]!.sessions[0]!.status).toBe('pending');
      expect(result.current.writeError).toBe("That didn't save — try again in a moment.");
    });

    it('clears a previous error on the next attempt', async () => {
      getWeekReviewFacts.mockResolvedValue({ review: REVIEW, facts: FACTS });
      confirmWeekReviewSession.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      const { result } = renderHook(() => useWeekReview());
      await waitFor(() => expect(result.current.state).toBe('ready'));

      await act(() => result.current.toggleSession('s1', true));
      expect(result.current.writeError).not.toBeNull();

      await act(() => result.current.toggleSession('s1', true));
      expect(result.current.writeError).toBeNull();
      expect(result.current.facts!.days[0]!.sessions[0]!.status).toBe('done');
    });
  });

  describe('toggleMeal', () => {
    it('flips the slot and writes through', async () => {
      getWeekReviewFacts.mockResolvedValue({ review: REVIEW, facts: FACTS });
      toggleWeekReviewMeal.mockResolvedValue(true);
      const { result } = renderHook(() => useWeekReview());
      await waitFor(() => expect(result.current.state).toBe('ready'));

      await act(() => result.current.toggleMeal('2026-08-17', 'lunch', true));

      expect(result.current.facts!.days[0]!.meals.find((m) => m.meal === 'lunch')!.logged).toBe(true);
      expect(toggleWeekReviewMeal).toHaveBeenCalledWith('2026-08-17', 'lunch', true);
    });
  });

  describe('toggleMindStep', () => {
    it('flips the named step and writes through', async () => {
      getWeekReviewFacts.mockResolvedValue({ review: REVIEW, facts: FACTS });
      toggleWeekReviewMindStep.mockResolvedValue(true);
      const { result } = renderHook(() => useWeekReview());
      await waitFor(() => expect(result.current.state).toBe('ready'));

      await act(() => result.current.toggleMindStep('g1', 'Write', true));

      expect(result.current.facts!.days[0]!.mind[0]!.steps![0]!.done).toBe(true);
      expect(toggleWeekReviewMindStep).toHaveBeenCalledWith('g1', 'Write', true);
    });
  });

  describe('toggleWeighIn', () => {
    it('flips the week-level weigh-in via the session route, no minutes', async () => {
      getWeekReviewFacts.mockResolvedValue({ review: REVIEW, facts: FACTS });
      confirmWeekReviewSession.mockResolvedValue(true);
      const { result } = renderHook(() => useWeekReview());
      await waitFor(() => expect(result.current.state).toBe('ready'));

      await act(() => result.current.toggleWeighIn(true));

      expect(result.current.facts!.weigh_in!.status).toBe('done');
      expect(confirmWeekReviewSession).toHaveBeenCalledWith('w1', true);
    });

    it('is a no-op when the week has no weigh-in scheduled', async () => {
      getWeekReviewFacts.mockResolvedValue({ review: REVIEW, facts: { ...FACTS, weigh_in: null } });
      const { result } = renderHook(() => useWeekReview());
      await waitFor(() => expect(result.current.state).toBe('ready'));

      await act(() => result.current.toggleWeighIn(true));

      expect(confirmWeekReviewSession).not.toHaveBeenCalled();
    });
  });
});
