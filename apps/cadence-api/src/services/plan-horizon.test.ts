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
const listSettledCommitmentDates = vi.fn();

vi.mock('../repos/plans.ts', () => ({ getActivePlan: (...a: unknown[]) => getActivePlan(...a) }));
vi.mock('../repos/activities.ts', () => ({ listActivities: (...a: unknown[]) => listActivities(...a) }));
vi.mock('../repos/users.ts', () => ({ getUser: (...a: unknown[]) => getUser(...a) }));
vi.mock('../repos/occurrences.ts', () => ({ upsertOccurrences: (...a: unknown[]) => upsertOccurrences(...a) }));
vi.mock('../repos/commitment-dates.ts', () => ({
  listSettledCommitmentDates: (...a: unknown[]) => listSettledCommitmentDates(...a),
}));

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
  listSettledCommitmentDates.mockResolvedValue([]);
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

/**
 * The second ruck (2026-09-06). The owner finished and logged a ruck; the coach then moved the
 * weigh-in to Monday, which committed a new plan version with fresh activity rows. The done ruck
 * stayed on the old row as history, the fill saw the new ruck row with nothing on today, and
 * issued the ruck again. The commitment lineage says they are one thing; the fill must read it.
 */
describe('ensureHorizon and a commitment already settled today', () => {
  const ruck = { activity_id: 'a-new', commitment_id: 'c-ruck', schedule: { recurrence: DAILY, time_of_day: '06:30' } };

  it('does not re-issue a commitment that is already done on that date, even after a commit', async () => {
    listActivities.mockResolvedValue([ruck]);
    listSettledCommitmentDates.mockResolvedValue([{ commitment_id: 'c-ruck', date: today }]);

    await ensureHorizon('u1', 2, { keepElapsedToday: true });

    expect(datesFor()).not.toContain(today);
    // Tomorrow is untouched — only the settled date is held back.
    expect(datesFor().length).toBeGreaterThan(0);
  });

  it('still issues a different commitment on the same date', async () => {
    listActivities.mockResolvedValue([{ ...ruck, activity_id: 'a-walk', commitment_id: 'c-walk' }]);
    listSettledCommitmentDates.mockResolvedValue([{ commitment_id: 'c-ruck', date: today }]);

    await ensureHorizon('u1', 2, { keepElapsedToday: true });

    expect(datesFor()).toContain(today);
  });

  it('an activity with no commitment lineage is never held back', async () => {
    listActivities.mockResolvedValue([{ ...ruck, commitment_id: undefined }]);
    listSettledCommitmentDates.mockResolvedValue([{ commitment_id: 'c-ruck', date: today }]);

    await ensureHorizon('u1', 2, { keepElapsedToday: true });

    expect(datesFor()).toContain(today);
  });
});

/**
 * The fill's half of the 2026-09-01 bug: at 20:05 in Montreal the UTC date is already tomorrow,
 * and a fill that starts there leaves the evening the person is still living in with nothing.
 */
describe("ensureHorizon and the user's own day", () => {
  it('starts from the local day, not the UTC one', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T00:05:00Z')); // 20:05 Tue 1 Sep, America/Toronto
    getUser.mockResolvedValue({ timezone: 'America/Toronto' });
    getActivePlan.mockResolvedValue({ plan_id: 'p2', generated_at: '2026-08-30T00:00:00Z' });
    listActivities.mockResolvedValue([{ activity_id: 'a1', schedule: { recurrence: DAILY, time_of_day: '21:00' } }]);
    try {
      await ensureHorizon('u1', 2, { keepElapsedToday: true });
      expect(datesFor()).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    } finally {
      vi.useRealTimers();
    }
  });
});
