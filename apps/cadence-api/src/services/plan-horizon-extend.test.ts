/**
 * `extendHorizon` (0049) — the guardrails, with the repos mocked so nothing touches the shared
 * DB. What matters here: extend-only (never shorten), the cap, and the top-up being anchored to
 * the WEEK'S start rather than today — the overshoot bug this math exists to avoid.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getActivePlan = vi.fn();
const setPlanHorizon = vi.fn();
vi.mock('../repos/plans.ts', () => ({
  getActivePlan: (...a: unknown[]) => getActivePlan(...a),
  setPlanHorizon: (...a: unknown[]) => setPlanHorizon(...a),
}));
const upsertOccurrences = vi.fn(async (..._a: unknown[]) => {});
vi.mock('../repos/occurrences.ts', () => ({
  upsertOccurrences: (...a: unknown[]) => upsertOccurrences(...a),
}));
vi.mock('../repos/activities.ts', () => ({ listActivities: vi.fn(async () => []) }));
vi.mock('../repos/users.ts', () => ({ getUser: vi.fn(async () => null) }));

const { extendHorizon, MAX_HORIZON_DAYS } = await import('./plan-horizon.ts');

const plan = (daysAgo: number, over: Record<string, unknown> = {}) => ({
  plan_id: 'p1',
  generated_at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
  horizon_days: 7,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  setPlanHorizon.mockResolvedValue(undefined);
});

describe('extendHorizon', () => {
  it('reports no_plan without writing anything', async () => {
    getActivePlan.mockResolvedValue(null);
    expect(await extendHorizon('u1', 14)).toEqual({ status: 'no_plan' });
    expect(setPlanHorizon).not.toHaveBeenCalled();
  });

  it('extends a mid-week plan to 14 days and says when the week now ends', async () => {
    getActivePlan.mockResolvedValue(plan(3));
    const r = await extendHorizon('u1', 14);
    expect(r.status).toBe('extended');
    if (r.status !== 'extended') return;
    expect(r.horizonDays).toBe(14);
    // ends_on = generated_at + 14, same arithmetic computeWeekState uses.
    const want = new Date(Date.now() - 3 * 86_400_000 + 14 * 86_400_000).toISOString().slice(0, 10);
    expect(r.endsOn).toBe(want);
    expect(setPlanHorizon).toHaveBeenCalledWith('p1', 14);
  });

  it('never shortens: asking for 7 on a 14-day week is unchanged, with the standing end reported', async () => {
    getActivePlan.mockResolvedValue(plan(3, { horizon_days: 14 }));
    const r = await extendHorizon('u1', 7);
    expect(r.status).toBe('unchanged');
    if (r.status !== 'unchanged') return;
    expect(r.horizonDays).toBe(14);
    expect(setPlanHorizon).not.toHaveBeenCalled();
  });

  it('asking for the length the week already has is unchanged, not a rewrite', async () => {
    getActivePlan.mockResolvedValue(plan(2));
    expect((await extendHorizon('u1', 7)).status).toBe('unchanged');
    expect(setPlanHorizon).not.toHaveBeenCalled();
  });

  it('clamps past the cap instead of stretching a week into a season', async () => {
    getActivePlan.mockResolvedValue(plan(0));
    const r = await extendHorizon('u1', 90);
    expect(r.status).toBe('extended');
    if (r.status !== 'extended') return;
    expect(r.horizonDays).toBe(MAX_HORIZON_DAYS);
  });

  it('a plan already older than 7 that never has a horizon_days column still extends (pre-0049 row)', async () => {
    getActivePlan.mockResolvedValue(plan(1, { horizon_days: undefined }));
    const r = await extendHorizon('u1', 14);
    expect(r.status).toBe('extended');
  });
});
