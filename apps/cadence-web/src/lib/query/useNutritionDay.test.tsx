/**
 * A day read that was refused is a failure, not an answer: it must not replace the day on screen.
 * `getNutritionDay` returns null for any refusal (an expired token, a 500), and as an answer that
 * null wiped good numbers until something else happened to ask again (2026-11-04).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, waitFor } from '@testing-library/react';
import { renderHookWithQuery } from '../../test/withQuery.tsx';
import { queryKeys } from './keys.ts';

const api = vi.hoisted(() => ({ getNutritionDay: vi.fn() }));
vi.mock('../api.ts', () => api);

const { RETRY_FAILED_READ_MS, useNutritionDay } = await import('./useNutritionDay.ts');
const DAY = '2026-11-04';
const good = { date: DAY, totals: { kcal: 584 }, meals: [], targets: { kcal: 2000 } };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useNutritionDay', () => {
  it('a refused read leaves the last good day in place', async () => {
    api.getNutritionDay.mockResolvedValue(null);
    const { client, result } = renderHookWithQuery(() => useNutritionDay(DAY));
    act(() => client.setQueryData(queryKeys.nutritionDay.day(DAY), good));
    await act(async () => {
      await client.invalidateQueries({ queryKey: queryKeys.nutritionDay.all });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toEqual(good);
  });

  it('with no day yet, a refused read is an error and not a null day', async () => {
    api.getNutritionDay.mockResolvedValue(null);
    const { result } = renderHookWithQuery(() => useNutritionDay(DAY));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it('a failed read is asked for again while something is showing it, and stops once it lands', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.getNutritionDay.mockResolvedValueOnce(null).mockResolvedValue(good);
    const { result } = renderHookWithQuery(() => useNutritionDay(DAY));
    await vi.waitFor(() => expect(result.current.isError).toBe(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETRY_FAILED_READ_MS);
    });
    await vi.waitFor(() => expect(result.current.data).toEqual(good));
    const calls = api.getNutritionDay.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETRY_FAILED_READ_MS * 3);
    });
    expect(api.getNutritionDay.mock.calls.length).toBe(calls);
  });
});
