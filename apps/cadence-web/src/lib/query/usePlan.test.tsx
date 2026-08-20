import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import React from 'react';
import { fetchPlanIntoCache, usePlan } from './usePlan.ts';
import type { PlanViewData } from '../api.ts';

const getPlan = vi.fn();
vi.mock('../api.ts', () => ({
  getPlan: (...a: unknown[]) => getPlan(...a),
}));

const WEEK: PlanViewData = {
  hasPlan: true,
  stage: 'committed',
  activities: [],
  week: [],
  consistency: { kept: 3, window: 7 },
};

/** Client defaults mirrored where they matter (staleTime); retry off so failures are immediate. */
function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } });
}

function wrapperFor(client: QueryClient) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = 'QueryWrapper';
  return Wrapper;
}

beforeEach(() => {
  getPlan.mockReset();
});

describe('usePlan (PERF-01: cached first paint)', () => {
  it('a remount inside staleTime paints from cache with no second fetch — the tab-switch case', async () => {
    getPlan.mockResolvedValue(WEEK);
    const client = makeClient();
    const wrapper = wrapperFor(client);

    const first = renderHook(() => usePlan(), { wrapper });
    await waitFor(() => expect(first.result.current.data).toEqual(WEEK));
    first.unmount(); // leaving the tab unmounts PlanView

    const second = renderHook(() => usePlan(), { wrapper });
    // Instant: the cached week is there on the FIRST render, before any await.
    expect(second.result.current.data).toEqual(WEEK);
    expect(getPlan).toHaveBeenCalledTimes(1);
  });

  it('a refetch that answers "could not load" keeps the last good week on screen', async () => {
    getPlan.mockResolvedValueOnce(WEEK);
    const client = makeClient();
    const { result } = renderHook(() => usePlan(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.data).toEqual(WEEK));

    getPlan.mockResolvedValueOnce(null); // the blip: getPlan's "could not load" answer
    const refetched = await result.current.refetch();

    // The refetch REALLY failed — asserted on its own return value, so this test cannot pass by
    // the failure quietly never happening.
    expect(refetched.status).toBe('error');
    expect(refetched.error).toBeInstanceOf(Error);

    // ...and the screen never noticed. React-query clears the error on the OBSERVER when a
    // background refetch fails on a query that already has data, so the tab keeps rendering the
    // last good week instead of flipping into an error state. Never a fabricated empty week and
    // never the typing dots: the 2026-08-19 rule that a failure must not be dressed as data.
    expect(result.current.data).toEqual(WEEK);
    expect(result.current.status).toBe('success');
    expect(result.current.error).toBeNull();
  });

  it('fetchPlanIntoCache seeds the cache the gate routes on, so PlanView mounts without a fetch (PERF-02)', async () => {
    getPlan.mockResolvedValue(WEEK);
    const client = makeClient();

    const routed = await fetchPlanIntoCache(client); // App.loadPlan's routing fetch
    expect(routed.stage).toBe('committed');

    const { result } = renderHook(() => usePlan(), { wrapper: wrapperFor(client) });
    expect(result.current.data).toEqual(WEEK); // painted synchronously from the seeded cache
    expect(getPlan).toHaveBeenCalledTimes(1); // the gate's round trip was the only one
  });

  it('fetchPlanIntoCache rejects on "could not load" — failure must never route as a plan stage', async () => {
    getPlan.mockResolvedValue(null);
    const client = makeClient();
    await expect(fetchPlanIntoCache(client)).rejects.toThrow();
  });
});
