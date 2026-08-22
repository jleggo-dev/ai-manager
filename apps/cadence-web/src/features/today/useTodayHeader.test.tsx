/**
 * The header's own wiring for A21 — the seam where a correct gate can still reach nothing.
 *
 * `placeDwell.test.ts` proves the decisions; these prove they are ACTED on, and that the one thing
 * that must never happen doesn't: a commute writing itself into `home_location`, which is what
 * notification timing, planning and the coach are all anchored to.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTodayHeader } from './useTodayHeader.ts';
import { rememberCandidate } from './placeDwell.ts';

const HOME = { lat: 45.4, lon: -73.9, label: "Notre-Dame-de-l'Île-Perrot, CA" };
const DOWNTOWN = { lat: 45.5, lon: -73.57 };

const getHomeLocation = vi.fn();
const saveHomeLocation = vi.fn(async () => ({}));
const saveCurrentLocation = vi.fn(async () => ({ ...DOWNTOWN, label: 'Montreal, CA' }));
const clearCurrentLocation = vi.fn(async () => true);
const getCoarseLocation = vi.fn();

vi.mock('../../lib/api.ts', () => ({
  getHomeLocation: () => getHomeLocation(),
  saveHomeLocation: (...a: unknown[]) => saveHomeLocation(...(a as [])),
  saveCurrentLocation: (...a: unknown[]) => saveCurrentLocation(...(a as [])),
  clearCurrentLocation: () => clearCurrentLocation(),
  browserTimezone: () => 'America/Toronto',
}));
vi.mock('../../lib/capability/index.ts', () => ({
  capabilities: { location: { isAvailable: () => true, getCoarseLocation: () => getCoarseLocation() } },
}));
// The sky is not what these tests are about; an unavailable reading also keeps the city coming
// from the stored label rather than from the provider's.
vi.mock('../../lib/query/index.ts', () => ({
  fetchWeatherCached: async () => ({ available: false }),
  forgetWeather: vi.fn(),
}));

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useTodayHeader(), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  getHomeLocation.mockResolvedValue({ home_location: HOME, current_location: null, timezone: 'America/Toronto' });
  getCoarseLocation.mockResolvedValue(DOWNTOWN);
});

describe('the Today header, deciding where you are', () => {
  it('does not move on the first sighting of somewhere new', async () => {
    mount();
    await waitFor(() => expect(getCoarseLocation).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(saveCurrentLocation).not.toHaveBeenCalled();
    expect(localStorage.getItem('cadence.place.candidate')).toContain('45.5');
  });

  it('commits the place that has kept you twenty minutes — and leaves home alone', async () => {
    rememberCandidate({ ...DOWNTOWN, firstSeenMs: Date.now() - 21 * 60_000 });
    mount();
    await waitFor(() => expect(saveCurrentLocation).toHaveBeenCalledWith({ lat: 45.5, lon: -73.57 }));
    expect(saveHomeLocation).not.toHaveBeenCalled(); // the anchor stays on the address
    expect(localStorage.getItem('cadence.place.candidate')).toBeNull();
  });

  it('drops the transient when you are home again', async () => {
    getHomeLocation.mockResolvedValue({
      home_location: HOME,
      current_location: { ...DOWNTOWN, label: 'Montreal, CA' },
      timezone: null,
    });
    getCoarseLocation.mockResolvedValue({ lat: 45.4, lon: -73.9 });
    mount();
    await waitFor(() => expect(clearCurrentLocation).toHaveBeenCalled());
    expect(saveCurrentLocation).not.toHaveBeenCalled();
  });

  it('names where you ARE, not where you live, while you are away', async () => {
    getHomeLocation.mockResolvedValue({
      home_location: HOME,
      current_location: { ...DOWNTOWN, label: 'Montreal, CA' },
      timezone: null,
    });
    getCoarseLocation.mockResolvedValue(DOWNTOWN);
    const { result } = mount();
    await waitFor(() => expect(result.current.city).toBe('Montreal, CA'));
  });

  it('still auto-detects a home for someone who has none', async () => {
    getHomeLocation.mockResolvedValue({ home_location: null, current_location: null, timezone: null });
    mount();
    await waitFor(() => expect(saveHomeLocation).toHaveBeenCalled());
    expect(saveCurrentLocation).not.toHaveBeenCalled();
  });

  it('takes "I am here now" at its word — one tap, no dwell', async () => {
    const { result } = mount();
    await waitFor(() => expect(getCoarseLocation).toHaveBeenCalled());
    await result.current.setHereNow();
    expect(saveCurrentLocation).toHaveBeenCalledWith({ lat: 45.5, lon: -73.57 });
    expect(saveHomeLocation).not.toHaveBeenCalled();
  });
});
