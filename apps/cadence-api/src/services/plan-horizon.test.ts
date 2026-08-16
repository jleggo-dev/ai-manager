import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A plan change must never delete the day you are standing in.
 *
 * The rolling top-up deliberately skips a slot whose hour has already gone — nobody wants a 6am
 * session materialized at 3pm. After a COMMIT that rule is exactly wrong, and on 2026-08-16 it ate
 * a day of the owner's plan: he applied a change to today's grip finisher in the afternoon, the
 * commit deleted today's pending rows, and re-materialization refused to recreate anything
 * scheduled earlier than that moment. The session he had just edited, and his breakfast log,
 * vanished. Only the evening items came back — which is what made it look like a partial glitch
 * rather than a rule doing precisely what it said.
 */

const getActivePlan = vi.fn();
const listActivities = vi.fn();
const getUser = vi.fn();
const upsertOccurrences = vi.fn();

vi.mock('../repos/plans.ts', () => ({ getActivePlan: (...a: unknown[]) => getActivePlan(...a) }));
vi.mock('../repos/activities.ts', () => ({ listActivities: (...a: unknown[]) => listActivities(...a) }));
vi.mock('../repos/users.ts', () => ({ getUser: (...a: unknown[]) => getUser(...a) }));
vi.mock('../repos/occurrences.ts', () => ({ upsertOccurrences: (...a: unknown[]) => upsertOccurrences(...a) }));

const { ensureHorizon } = await import('./plan-horizon.ts');

const today = new Date().toISOString().slice(0, 10);
/** Every day, so `today` is always in the expansion whatever day the suite runs. */
const DAILY = 'FREQ=DAILY';

beforeEach(() => {
  vi.clearAllMocks();
  getActivePlan.mockResolvedValue({ plan_id: 'p2', generated_at: `${today}T00:00:00Z` });
  // No timezone → localMinutes falls back to UTC, so "now" is comparable in the assertions below.
  getUser.mockResolvedValue({ timezone: 'UTC' });
  upsertOccurrences.mockResolvedValue(undefined);
});

/** The dates this run would have created for a given activity. */
const datesFor = (): string[] =>
  ((upsertOccurrences.mock.calls[0]?.[0] ?? []) as Array<{ date: string }>).map((o) => o.date);

describe('ensureHorizon and today', () => {
  it('skips a slot whose hour has passed on the routine top-up', async () => {
    listActivities.mockResolvedValue([{ activity_id: 'a1', schedule: { recurrence: DAILY, time_of_day: '00:01' } }]);

    await ensureHorizon('u1', 2);

    expect(datesFor()).not.toContain(today);
  });

  it('rebuilds today in full after a commit, including the hours already gone', async () => {
    listActivities.mockResolvedValue([{ activity_id: 'a1', schedule: { recurrence: DAILY, time_of_day: '00:01' } }]);

    await ensureHorizon('u1', 2, { keepElapsedToday: true });

    expect(datesFor()).toContain(today);
  });

  it('still materializes a later slot today on the routine top-up', async () => {
    listActivities.mockResolvedValue([{ activity_id: 'a1', schedule: { recurrence: DAILY, time_of_day: '23:59' } }]);

    await ensureHorizon('u1', 2);

    expect(datesFor()).toContain(today);
  });

  it('leaves an activity with no time of day alone either way — nothing has elapsed', async () => {
    listActivities.mockResolvedValue([{ activity_id: 'a1', schedule: { recurrence: DAILY } }]);

    await ensureHorizon('u1', 2);

    expect(datesFor()).toContain(today);
  });
});
