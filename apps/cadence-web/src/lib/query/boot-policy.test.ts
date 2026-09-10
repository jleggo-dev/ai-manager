/**
 * The boot cache's forecast entry: a series is painted before the network answers, a FAILED read
 * is not. Seeding a failure would put "I couldn't read the days ahead" on screen before this
 * launch had tried, and hold it there through the stale window (owner, on device, 2026-09-09).
 */
import { describe, expect, it } from 'vitest';
import { policyFor } from './boot-policy.ts';
import { queryKeys } from './keys.ts';

describe('the forecast boot policy', () => {
  const policy = policyFor(queryKeys.forecast.all);
  const revive = (d: unknown) => policy.revive!(d, Date.now(), queryKeys.forecast.all);

  it('revives a series', () => {
    const series = { available: true, hourly: [], daily: [] };
    expect(revive(series)).toBe(series);
  });

  it('revives the server’s own "no forecast" — an answer worth an hour', () => {
    const none = { available: false };
    expect(revive(none)).toBe(none);
  });

  it('refuses a failed read', () => {
    expect(revive({ available: false, error: true })).toBeNull();
  });

  it('tolerates an empty entry', () => {
    expect(revive(undefined)).toBeUndefined();
  });
});
