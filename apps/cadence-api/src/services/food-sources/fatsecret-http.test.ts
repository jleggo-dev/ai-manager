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

  it('refuses to call without credentials rather than sending an unsigned request', async () => {
    const fetchMock = vi.fn();
    __setFatSecretFetchForTests(fetchMock as unknown as typeof fetch);
    const { fatSecretCall } = await import('./fatsecret-http.ts');
    await expect(fatSecretCall({ method: 'foods.search' })).rejects.toThrow(/not configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
