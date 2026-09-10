/**
 * The forecast through the cache: a read that FAILS never displaces a series the sheet already
 * has, and the failure is stored only when there was nothing to keep — so the sheet can say so.
 *
 * Pinned because the old behaviour was silent: one bad read at launch (a token not yet landed,
 * a socket the OS suspended) overwrote last launch's ten days with "no forecast", and the sheet
 * showed the reading alone for the rest of the hour with nothing to indicate why (owner, on
 * device, 2026-09-09).
 */
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Forecast } from '../api.ts';

const getForecast = vi.fn<() => Promise<Forecast>>();
vi.mock('../api.ts', () => ({
  getForecast: () => getForecast(),
  getWeather: vi.fn(),
  getHomeLocation: vi.fn(),
  getDailyCheckinStatus: vi.fn(),
}));

const { prefetchForecast, refetchForecast } = await import('./useAmbient.ts');
const { queryKeys } = await import('./keys.ts');

const SERIES: Forecast = {
  available: true,
  timezone: 'America/Toronto',
  source: 'weatherkit',
  hourly: [{ at: '2026-09-10T02:00:00.000Z', temp_c: 22, conditions: 'clear', precip_chance: 0 }],
  daily: [{ date: '2026-09-10', high_c: 24, low_c: 15, conditions: 'clear', precip_chance: 0 }],
};
const FAILED: Forecast = { available: false, error: true };
const NONE: Forecast = { available: false };

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe('the forecast read, through the cache', () => {
  beforeEach(() => {
    getForecast.mockReset();
  });

  it('stores a good series', async () => {
    const qc = client();
    getForecast.mockResolvedValueOnce(SERIES);
    await prefetchForecast(qc);
    expect(qc.getQueryData(queryKeys.forecast.all)).toEqual(SERIES);
  });

  it('keeps the last good series when the next read fails', async () => {
    const qc = client();
    qc.setQueryData(queryKeys.forecast.all, SERIES);
    getForecast.mockResolvedValueOnce(FAILED);
    const out = await refetchForecast(qc);
    expect(out).toEqual(SERIES);
    expect(qc.getQueryData(queryKeys.forecast.all)).toEqual(SERIES);
  });

  it('stores the failure when there was nothing to keep — so the sheet can say so', async () => {
    const qc = client();
    getForecast.mockResolvedValueOnce(FAILED);
    await prefetchForecast(qc);
    expect(qc.getQueryData(queryKeys.forecast.all)).toEqual(FAILED);
  });

  it('lets the server’s own "no forecast" replace a series — that is an answer, not a failure', async () => {
    const qc = client();
    qc.setQueryData(queryKeys.forecast.all, SERIES);
    getForecast.mockResolvedValueOnce(NONE);
    const out = await refetchForecast(qc);
    expect(out).toEqual(NONE);
  });

  it('replaces a stored failure with the next good read', async () => {
    const qc = client();
    qc.setQueryData(queryKeys.forecast.all, FAILED);
    getForecast.mockResolvedValueOnce(SERIES);
    const out = await refetchForecast(qc);
    expect(out).toEqual(SERIES);
  });

  it('a retry reads now, even inside the stale window', async () => {
    const qc = client();
    getForecast.mockResolvedValueOnce(FAILED).mockResolvedValueOnce(SERIES);
    await prefetchForecast(qc);
    await refetchForecast(qc);
    expect(getForecast).toHaveBeenCalledTimes(2);
    expect(qc.getQueryData(queryKeys.forecast.all)).toEqual(SERIES);
  });
});
