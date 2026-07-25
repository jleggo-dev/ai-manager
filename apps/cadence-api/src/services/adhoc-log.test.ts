import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getActivePlan = vi.fn();
const getOrCreateAdhocActivity = vi.fn();
const getOrInsertOccurrenceId = vi.fn();
const logOccurrence = vi.fn();

vi.mock('../repos/plans.ts', () => ({ getActivePlan: (...a: unknown[]) => getActivePlan(...a) }));
vi.mock('../repos/activities.ts', () => ({
  getOrCreateAdhocActivity: (...a: unknown[]) => getOrCreateAdhocActivity(...a),
}));
vi.mock('../repos/occurrences.ts', () => ({
  getOrInsertOccurrenceId: (...a: unknown[]) => getOrInsertOccurrenceId(...a),
}));
vi.mock('./session-log.ts', () => ({ logOccurrence: (...a: unknown[]) => logOccurrence(...a) }));

import { logAdhocActivity, resolveAdhocDate } from './adhoc-log.ts';

const USER = '00000000-0000-4000-a000-00000000b101';

describe('resolveAdhocDate', () => {
  const NOW = Date.UTC(2026, 6, 15, 12); // 2026-07-15 noon UTC

  it('defaults to today (UTC) when no date is given', () => {
    expect(resolveAdhocDate(undefined, NOW)).toBe('2026-07-15');
  });
  it('accepts today and a recent past date', () => {
    expect(resolveAdhocDate('2026-07-15', NOW)).toBe('2026-07-15');
    expect(resolveAdhocDate('2026-07-10', NOW)).toBe('2026-07-10');
  });
  it('rejects a future date', () => {
    expect(resolveAdhocDate('2026-07-16', NOW)).toBeNull();
  });
  it('allows exactly 14 days back but not 15', () => {
    expect(resolveAdhocDate('2026-07-01', NOW)).toBe('2026-07-01'); // 14 days
    expect(resolveAdhocDate('2026-06-30', NOW)).toBeNull(); // 15 days
  });
  it('rejects a malformed date', () => {
    expect(resolveAdhocDate('not-a-date', NOW)).toBeNull();
  });
});

describe('logAdhocActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00.000Z'));
    getActivePlan.mockResolvedValue({ plan_id: 'p1' });
    getOrCreateAdhocActivity.mockResolvedValue({ activity_id: 'a1' });
    getOrInsertOccurrenceId.mockResolvedValue('occ1');
    logOccurrence.mockResolvedValue({ log: { items: [], summary: 'yoga', raw_text: 'did yoga' }, summary: 'yoga' });
  });
  afterEach(() => vi.useRealTimers());

  it('returns null when there is no active plan (and never creates the bucket activity)', async () => {
    getActivePlan.mockResolvedValue(null);
    expect(await logAdhocActivity(USER, 'did yoga')).toBeNull();
    expect(getOrCreateAdhocActivity).not.toHaveBeenCalled();
  });

  it('returns null for an out-of-range date without ever touching the plan', async () => {
    expect(await logAdhocActivity(USER, 'did yoga', '2026-07-16')).toBeNull();
    expect(getActivePlan).not.toHaveBeenCalled();
  });

  it('lands the off-plan log as a done occurrence on today, via the normal log path', async () => {
    const r = await logAdhocActivity(USER, 'did yoga');
    expect(getOrCreateAdhocActivity).toHaveBeenCalledWith(USER, 'p1');
    expect(getOrInsertOccurrenceId).toHaveBeenCalledWith('a1', USER, '2026-07-15');
    expect(logOccurrence).toHaveBeenCalledWith(USER, 'occ1', 'did yoga');
    expect(r?.summary).toBe('yoga');
  });

  it('honors an explicit valid past date', async () => {
    await logAdhocActivity(USER, 'walked 5k', '2026-07-12');
    expect(getOrInsertOccurrenceId).toHaveBeenCalledWith('a1', USER, '2026-07-12');
  });
});
