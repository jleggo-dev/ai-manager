/**
 * "Show logged, sharpen it after" — the client half.
 *
 * The properties worth defending: it must not fire twice for the same meal on a re-render, it must
 * be silent when nothing improved (a flicker for no change is worse than no update), and it must
 * retry on a fresh visit so an app closed mid-lookup heals itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { Meal, NutritionDayData } from '../../lib/api.ts';

const enrichMeal = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api.ts', () => ({ enrichMeal }));

import { mealsNeedingEnrich, useMealEnrichment } from './useMealEnrichment.ts';

const meal = (over: Partial<Meal> = {}): Meal =>
  ({ log_id: 'm1', meal: 'lunch', items: [], macros: null, flags: { needs_enrich: true }, ...over }) as Meal;
const day = (meals: Meal[]): NutritionDayData => ({ meals }) as NutritionDayData;

beforeEach(() => {
  enrichMeal.mockReset();
  enrichMeal.mockResolvedValue({ improved: 1 });
});

describe('mealsNeedingEnrich', () => {
  it('picks flagged meals that have not been looked up yet', () => {
    expect(mealsNeedingEnrich([meal(), meal({ log_id: 'm2', flags: {} })])).toEqual(['m1']);
  });

  it('skips one already enriched — that is what makes a retry free', () => {
    expect(mealsNeedingEnrich([meal({ flags: { needs_enrich: true, enriched: true } })])).toEqual([]);
  });
});

describe('useMealEnrichment', () => {
  it('kicks the lookup and refreshes the day when something actually improved', async () => {
    const onImproved = vi.fn();
    renderHook(() => useMealEnrichment(day([meal()]), onImproved));
    await waitFor(() => expect(enrichMeal).toHaveBeenCalledWith('m1'));
    await waitFor(() => expect(onImproved).toHaveBeenCalledTimes(1));
  });

  it('stays silent when the lookup found nothing — no flicker for no change', async () => {
    enrichMeal.mockResolvedValue({ improved: 0 });
    const onImproved = vi.fn();
    renderHook(() => useMealEnrichment(day([meal()]), onImproved));
    await waitFor(() => expect(enrichMeal).toHaveBeenCalled());
    expect(onImproved).not.toHaveBeenCalled();
  });

  it('does not fire twice for the same meal across re-renders', async () => {
    const d = day([meal()]);
    const { rerender } = renderHook(({ x }) => useMealEnrichment(x, vi.fn()), { initialProps: { x: d } });
    await waitFor(() => expect(enrichMeal).toHaveBeenCalledTimes(1));
    rerender({ x: d });
    rerender({ x: { ...d } as NutritionDayData });
    await new Promise((r) => setTimeout(r, 10));
    expect(enrichMeal).toHaveBeenCalledTimes(1);
  });

  it('does nothing at all when no meal needs it', () => {
    renderHook(() => useMealEnrichment(day([meal({ flags: {} })]), vi.fn()));
    expect(enrichMeal).not.toHaveBeenCalled();
  });

  it('retries on a fresh visit, so an app closed mid-lookup heals itself', async () => {
    const { unmount } = renderHook(() => useMealEnrichment(day([meal()]), vi.fn()));
    await waitFor(() => expect(enrichMeal).toHaveBeenCalledTimes(1));
    unmount();
    renderHook(() => useMealEnrichment(day([meal()]), vi.fn()));
    await waitFor(() => expect(enrichMeal).toHaveBeenCalledTimes(2));
  });
});
