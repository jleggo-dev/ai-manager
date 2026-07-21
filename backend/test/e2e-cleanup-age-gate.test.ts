/**
 * Unit tests — soft-cleanup age-gate (PR #86).
 * Pure; no DB. Locks the concurrent-CI safety contract: soft mode never
 * targets rows younger than the min age; full wipe has no age gate.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_SOFT_MIN_AGE_MS, resolveOlderThanIso } from '../scripts/lib/e2e-cleanup-age-gate.ts';

describe('resolveOlderThanIso (soft cleanup age-gate)', () => {
  const FIXED_NOW = Date.parse('2026-07-20T18:00:00.000Z');

  it('returns null when soft is false (full wipe, any age)', () => {
    expect(resolveOlderThanIso(false, { nowMs: FIXED_NOW })).toBeNull();
    expect(
      resolveOlderThanIso(false, {
        nowMs: FIXED_NOW,
        envMinAgeMs: '60000',
        minAgeMs: 60_000,
      }),
    ).toBeNull();
  });

  it('defaults to 20 minutes under soft mode', () => {
    const cutoff = resolveOlderThanIso(true, { nowMs: FIXED_NOW });
    expect(cutoff).toBe(new Date(FIXED_NOW - DEFAULT_SOFT_MIN_AGE_MS).toISOString());
    expect(DEFAULT_SOFT_MIN_AGE_MS).toBe(20 * 60 * 1000);
  });

  it('honors E2E_CLEANUP_MIN_AGE_MS when soft', () => {
    const cutoff = resolveOlderThanIso(true, {
      nowMs: FIXED_NOW,
      envMinAgeMs: String(5 * 60 * 1000),
    });
    expect(cutoff).toBe(new Date(FIXED_NOW - 5 * 60 * 1000).toISOString());
  });

  it('falls back to default for invalid env values', () => {
    for (const bad of ['', 'abc', '-1', 'NaN']) {
      const cutoff = resolveOlderThanIso(true, {
        nowMs: FIXED_NOW,
        envMinAgeMs: bad,
      });
      expect(cutoff).toBe(new Date(FIXED_NOW - DEFAULT_SOFT_MIN_AGE_MS).toISOString());
    }
  });

  it('keeps fresh in-flight rows outside the soft delete window', () => {
    /* A session created "now" is newer than the cutoff → soft cleanup must skip it. */
    const cutoffIso = resolveOlderThanIso(true, { nowMs: FIXED_NOW });
    expect(cutoffIso).not.toBeNull();
    if (cutoffIso == null) return;
    const freshCreatedAt = new Date(FIXED_NOW - 60_000).toISOString(); /* 1 min old */
    const staleCreatedAt = new Date(FIXED_NOW - DEFAULT_SOFT_MIN_AGE_MS - 1).toISOString();
    expect(freshCreatedAt >= cutoffIso).toBe(true);
    expect(staleCreatedAt < cutoffIso).toBe(true);
  });
});
