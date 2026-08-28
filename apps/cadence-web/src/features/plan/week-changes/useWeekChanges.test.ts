import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useWeekChanges } from './useWeekChanges.ts';

const api = vi.hoisted(() => ({
  getPendingChangeDetail: vi.fn(),
  setPendingChangeToggles: vi.fn(async () => true),
  lockPlan: vi.fn(async () => ({ status: 200, body: {} })),
}));
vi.mock('../../../lib/api.ts', () => api);

const ITEMS = [
  { index: 0, title: 'Easy run', enabled: true, now: 'Thu · 6:30 pm', next: 'Fri · 6:15 am', change_reason: 'why' },
  { index: 1, title: 'Second strength day', enabled: false, now: null, next: 'Sat · 9 am' },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.getPendingChangeDetail.mockResolvedValue({ plan_version: 4, items: ITEMS });
  api.setPendingChangeToggles.mockResolvedValue(true);
  api.lockPlan.mockResolvedValue({ status: 200, body: {} });
});

describe('useWeekChanges', () => {
  it('starts loading, then settles to ready with the plan version and items', async () => {
    const { result } = renderHook(() => useWeekChanges());
    expect(result.current.state).toBe('loading');
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.planVersion).toBe(4);
    expect(result.current.items).toEqual(ITEMS);
  });

  it("defaults every toggle from the item's own `enabled` — optional starts off", async () => {
    const { result } = renderHook(() => useWeekChanges());
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.enabled[0]).toBe(true);
    expect(result.current.enabled[1]).toBe(false);
    expect(result.current.enabledCount).toBe(1);
  });

  it('settles to unavailable, not an error thrown, when nothing is pending', async () => {
    api.getPendingChangeDetail.mockResolvedValue({ plan_version: null, items: [] });
    const { result } = renderHook(() => useWeekChanges());
    await waitFor(() => expect(result.current.state).toBe('unavailable'));
  });

  it('settles to the same unavailable state when the fetch rejects outright', async () => {
    api.getPendingChangeDetail.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useWeekChanges());
    await waitFor(() => expect(result.current.state).toBe('unavailable'));
  });

  it('flipping a toggle updates enabledCount', async () => {
    const { result } = renderHook(() => useWeekChanges());
    await waitFor(() => expect(result.current.state).toBe('ready'));

    act(() => result.current.toggle(1));
    await waitFor(() => expect(result.current.enabledCount).toBe(2));

    act(() => result.current.toggle(0));
    await waitFor(() => expect(result.current.enabledCount).toBe(1));
  });

  it('apply() posts the toggles, THEN locks — in that order, with the live toggle state', async () => {
    const { result } = renderHook(() => useWeekChanges());
    await waitFor(() => expect(result.current.state).toBe('ready'));
    act(() => result.current.toggle(1)); // flip the optional add ON

    let ok = false;
    await act(async () => {
      ok = await result.current.apply();
    });

    expect(ok).toBe(true);
    expect(api.setPendingChangeToggles).toHaveBeenCalledWith([
      { index: 0, enabled: true },
      { index: 1, enabled: true },
    ]);
    expect(api.lockPlan).toHaveBeenCalledTimes(1);
    // Order: toggles persisted before the commit reads them.
    const toggleOrder = api.setPendingChangeToggles.mock.invocationCallOrder[0]!;
    const lockOrder = api.lockPlan.mock.invocationCallOrder[0]!;
    expect(toggleOrder).toBeLessThan(lockOrder);
  });

  it('reports failure and never locks when persisting the toggles fails', async () => {
    api.setPendingChangeToggles.mockResolvedValue(false);
    const { result } = renderHook(() => useWeekChanges());
    await waitFor(() => expect(result.current.state).toBe('ready'));

    let ok = true;
    await act(async () => {
      ok = await result.current.apply();
    });

    expect(ok).toBe(false);
    expect(result.current.applyState).toBe('failed');
    expect(api.lockPlan).not.toHaveBeenCalled();
  });

  it('reports failure when the lock itself fails, after toggles already saved', async () => {
    api.lockPlan.mockResolvedValue({ status: 422, body: {} });
    const { result } = renderHook(() => useWeekChanges());
    await waitFor(() => expect(result.current.state).toBe('ready'));

    let ok = true;
    await act(async () => {
      ok = await result.current.apply();
    });

    expect(ok).toBe(false);
    expect(result.current.applyState).toBe('failed');
  });
});
