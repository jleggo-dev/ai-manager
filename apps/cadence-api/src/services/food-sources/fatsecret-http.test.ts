/**
 * OAuth 1.0 signing and the HTTP guards. No credentials needed — the signature is checked against
 * a fixed key/nonce/timestamp, which is the only way to test it deterministically.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

/**
 * The config is MOCKED rather than read from the environment: once real credentials landed in
 * apps/cadence-api/.env these assertions started depending on whose machine they ran on, which is
 * not a test. Configured-ness is set explicitly per case here.
 */
vi.mock('../../config.ts', () => ({
  cadenceConfig: { fatSecret: { consumerKey: '', consumerSecret: '' } },
}));

import { cadenceConfig } from '../../config.ts';
import { signRequest, __setFatSecretFetchForTests, isFatSecretConfigured } from './fatsecret-http.ts';

describe('signRequest (OAuth 1.0, two-legged)', () => {
  const fixed = { nonce: 'abc123', timestamp: '1700000000', url: 'https://platform.fatsecret.com/rest/server.api' };

  it('produces a stable signature for the same inputs', () => {
    const a = signRequest({ method: 'foods.search', search_expression: 'peanuts' }, 'KEY', 'SECRET', fixed);
    const b = signRequest({ method: 'foods.search', search_expression: 'peanuts' }, 'KEY', 'SECRET', fixed);
    expect(a.oauth_signature).toBe(b.oauth_signature);
    expect(a.oauth_signature_method).toBe('HMAC-SHA1');
    expect(a.oauth_version).toBe('1.0');
    expect(a.oauth_consumer_key).toBe('KEY');
  });

  it('signs over the method parameters too, not just the oauth ones', () => {
    const a = signRequest({ method: 'foods.search', search_expression: 'peanuts' }, 'KEY', 'SECRET', fixed);
    const b = signRequest({ method: 'foods.search', search_expression: 'almonds' }, 'KEY', 'SECRET', fixed);
    expect(a.oauth_signature).not.toBe(b.oauth_signature);
  });

  it('changes with the secret', () => {
    const a = signRequest({ method: 'food.get' }, 'KEY', 'SECRET', fixed);
    const b = signRequest({ method: 'food.get' }, 'KEY', 'OTHER', fixed);
    expect(a.oauth_signature).not.toBe(b.oauth_signature);
  });

  /**
   * encodeURIComponent leaves !*'() alone and OAuth requires them escaped. A food search hits this
   * the first time somebody types an apostrophe — "Trader Joe's" — and the failure is a 401 that
   * looks like bad credentials rather than bad encoding.
   */
  it('survives a query with characters encodeURIComponent would not escape', () => {
    const signed = signRequest({ method: 'foods.search', search_expression: "Trader Joe's (5*)" }, 'K', 'S', fixed);
    expect(signed.oauth_signature).toBeTruthy();
    expect(typeof signed.oauth_signature).toBe('string');
  });

  it('nonce and timestamp vary between calls when not pinned', () => {
    const a = signRequest({ method: 'food.get' }, 'KEY', 'SECRET');
    const b = signRequest({ method: 'food.get' }, 'KEY', 'SECRET');
    expect(a.oauth_nonce).not.toBe(b.oauth_nonce);
  });
});

describe('the client', () => {
  beforeEach(() => {
    cadenceConfig.fatSecret.consumerKey = '';
    cadenceConfig.fatSecret.consumerSecret = '';
  });
  afterEach(() => __setFatSecretFetchForTests(null));

  it('reports itself unconfigured when there are no credentials', () => {
    expect(isFatSecretConfigured()).toBe(false);
  });

  it('reports itself configured once both halves are present', () => {
    cadenceConfig.fatSecret.consumerKey = 'k';
    cadenceConfig.fatSecret.consumerSecret = 's';
    expect(isFatSecretConfigured()).toBe(true);
    // One half alone is not credentials.
    cadenceConfig.fatSecret.consumerSecret = '';
    expect(isFatSecretConfigured()).toBe(false);
  });

  /**
   * FatSecret reports quota exhaustion as HTTP 200 with `error.code`, so the 429 branch never sees
   * it. Before this, hitting the daily cap meant a failed call on every subsequent pricing with no
   * back-off at all — the API would be hammered for the rest of the day.
   */
  it('backs off when the daily limit is reported as a 200 with an error body', async () => {
    cadenceConfig.fatSecret.consumerKey = 'k';
    cadenceConfig.fatSecret.consumerSecret = 's';
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 11, message: 'Application request limit reached' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    __setFatSecretFetchForTests(fetchMock as unknown as typeof fetch);
    const { fatSecretCall } = await import('./fatsecret-http.ts');

    await expect(fatSecretCall({ method: 'foods.search', search_expression: 'a' })).rejects.toThrow(/limit/i);
    expect(fetchMock).toHaveBeenCalledOnce();

    // The next call waits on the cooldown rather than going straight back out.
    const started = Date.now();
    const pending = fatSecretCall({ method: 'foods.search', search_expression: 'b' });
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(Date.now() - started).toBeLessThan(50); // it is waiting, not blocking the event loop
    void pending.catch(() => undefined);
    __setFatSecretFetchForTests(null); // clears the cooldown so the suite does not stall
  });

  it('surfaces a non-throttling error without cooling down', async () => {
    cadenceConfig.fatSecret.consumerKey = 'k';
    cadenceConfig.fatSecret.consumerSecret = 's';
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 5, message: 'Invalid consumer key' } }), { status: 200 }),
    );
    __setFatSecretFetchForTests(fetchMock as unknown as typeof fetch);
    const { fatSecretCall } = await import('./fatsecret-http.ts');

    await expect(fatSecretCall({ method: 'food.get.v4', food_id: '1' })).rejects.toThrow(/consumer key/i);
    // Bad credentials are not a reason to pause; the second call goes out immediately.
    await expect(fatSecretCall({ method: 'food.get.v4', food_id: '2' })).rejects.toThrow(/consumer key/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuses to call without credentials rather than sending an unsigned request', async () => {
    const fetchMock = vi.fn();
    __setFatSecretFetchForTests(fetchMock as unknown as typeof fetch);
    const { fatSecretCall } = await import('./fatsecret-http.ts');
    await expect(fatSecretCall({ method: 'foods.search' })).rejects.toThrow(/not configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
