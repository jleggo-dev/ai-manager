/**
 * FoodData Central's coin-flip outage, and telling it apart from a real answer.
 *
 * Measured 2026-08-23: the same search repeated eight times succeeded three. The failures arrive
 * as **404 carrying the FDC website's HTML error page** — the request never reached the API, but
 * api.data.gov counts it anyway. Because `enrichFoodsWithUsda` swallows failures by design, this
 * read as "no USDA match" rather than as an outage: whole foods quietly fell through to a pinned
 * guess and the ledger held two USDA rows in total.
 *
 * The discriminator these tests pin is CONTENT-TYPE, and it is the whole subtlety. A 404 is a
 * perfectly good API answer for an fdcId that does not exist, and retrying that one three times
 * would spend the rate limit re-asking a question already answered. JSON means the API spoke.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * The key is stubbed on the CONFIG, not the environment.
 *
 * `cadenceConfig` reads process.env once at module load, so `vi.stubEnv('USDA_API_KEY', …)` after
 * the import does nothing at all — these tests passed locally purely because a real key sat in
 * .env, and failed the moment CI ran them without one. A test that passes for a reason it does not
 * state is not passing.
 */
vi.mock('../../config.ts', async (orig) => {
  const actual = (await orig()) as { cadenceConfig: Record<string, unknown> };
  return { ...actual, cadenceConfig: { ...actual.cadenceConfig, usdaApiKey: 'test-key-not-real' } };
});

import { __setUsdaFetchForTests, usdaGet } from './usda-http.ts';

const HTML = { 'content-type': 'text/html; charset=utf-8' };
const JSON_CT = { 'content-type': 'application/json' };

function res(status: number, headers: Record<string, string>, body: unknown = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
}

afterEach(() => {
  __setUsdaFetchForTests(null);
});

describe('USDA transport retries', () => {
  it('retries an HTML 404 and returns the answer when the service comes back', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(404, HTML, '<!DOCTYPE html><html>…</html>'))
      .mockResolvedValueOnce(res(200, JSON_CT, { foods: [{ fdcId: 1 }] }));
    __setUsdaFetchForTests(fetchMock);

    await expect(usdaGet('/foods/search?query=kale')).resolves.toEqual({ foods: [{ fdcId: 1 }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a JSON 404 — that is the API answering "no such food"', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(404, JSON_CT, { error: 'not found' }));
    __setUsdaFetchForTests(fetchMock);

    await expect(usdaGet('/food/999999999')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after a bounded number of attempts rather than hammering', async () => {
    // The rung is optional; the next one answers. Retrying forever would spend the shared
    // api.data.gov quota on a service that is already down.
    const fetchMock = vi.fn().mockResolvedValue(res(404, HTML, '<!DOCTYPE html>'));
    __setUsdaFetchForTests(fetchMock);

    await expect(usdaGet('/foods/search?query=kale')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries a 5xx too', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(503, HTML, 'upstream down'))
      .mockResolvedValueOnce(res(200, JSON_CT, { ok: true }));
    __setUsdaFetchForTests(fetchMock);

    await expect(usdaGet('/foods/search?query=kale')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
