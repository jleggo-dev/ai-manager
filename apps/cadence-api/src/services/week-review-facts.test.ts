import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `buildWeekReviewFacts` is a pure join over four mocked repo reads — same mocked-repo style
 * `session-generate.test.ts` and `plan-view.test.ts` use. No clearMocks in vitest config, so every
 * mock is given a fresh default in `beforeEach` rather than relying on call-count resets.
 */
vi.mock('../repos/plans.ts', () => ({ getActivePlan: vi.fn() }));
vi.mock('../repos/activities.ts', () => ({ listActivities: vi.fn() }));
vi.mock('../repos/goals.ts', () => ({ listGoals: vi.fn() }));
vi.mock('../repos/occurrences.ts', () => ({
  findWeighInOccurrence: vi.fn(),
  listOccurrences: vi.fn(),
  listOccurrenceSessionLogs: vi.fn(),
}));

import { getActivePlan } from '../repos/plans.ts';
import { listActivities } from '../repos/activities.ts';
import { listGoals } from '../repos/goals.ts';
import { findWeighInOccurrence, listOccurrences, listOccurrenceSessionLogs } from '../repos/occurrences.ts';
import { buildWeekReviewFacts } from './week-review-facts.ts';

const FROM = '2026-08-24';
const TO = '2026-08-25'; // 2-day window keeps fixtures small; enumerateDates is exercised separately below

const PLAN = { plan_id: 'p1' };

function activity(over: Record<string, unknown>) {
  return { activity_id: 'a1', kind: 'user', title: 'Easy run', schedule: {}, ...over };
}

function occ(over: Record<string, unknown>) {
  return { occurrence_id: 'o1', activity_id: 'a1', date: '2026-08-24', status: 'pending', ...over };
}

beforeEach(() => {
  vi.mocked(getActivePlan)
    .mockReset()
    .mockResolvedValue(PLAN as never);
  vi.mocked(listActivities)
    .mockReset()
    .mockResolvedValue([] as never);
  vi.mocked(listGoals)
    .mockReset()
    .mockResolvedValue([] as never);
  vi.mocked(listOccurrences)
    .mockReset()
    .mockResolvedValue([] as never);
  vi.mocked(listOccurrenceSessionLogs)
    .mockReset()
    .mockResolvedValue([] as never);
  vi.mocked(findWeighInOccurrence).mockReset().mockResolvedValue(null);
});

describe('buildWeekReviewFacts', () => {
  it('gives every date in the window its own day, even with nothing on it', async () => {
    const facts = await buildWeekReviewFacts('u1', FROM, TO);
    expect(facts.days.map((d) => d.date)).toEqual(['2026-08-24', '2026-08-25']);
    for (const d of facts.days) {
      expect(d.meals.map((m) => m.meal)).toEqual(['breakfast', 'lunch', 'dinner']);
      expect(d.meals.every((m) => m.occurrence_id === null && m.logged === false)).toBe(true);
      expect(d.sessions).toEqual([]);
      expect(d.mind).toEqual([]);
    }
  });

  it('returns an empty grid (not an error) when the user has no active plan', async () => {
    vi.mocked(getActivePlan).mockResolvedValue(null);
    vi.mocked(listOccurrences).mockResolvedValue([occ({})] as never);
    const facts = await buildWeekReviewFacts('u1', FROM, TO);
    // No activities means the occurrence can't resolve a title — it's dropped, not thrown.
    expect(facts.days.flatMap((d) => d.sessions)).toEqual([]);
    expect(listActivities).not.toHaveBeenCalled();
  });

  it('places a movement session with its planned and logged minutes', async () => {
    vi.mocked(listActivities).mockResolvedValue([
      activity({ activity_id: 'a1', kind: 'user', title: 'Easy run', schedule: { duration_min: 40 } }),
    ] as never);
    vi.mocked(listOccurrences).mockResolvedValue([
      occ({ occurrence_id: 'o1', activity_id: 'a1', date: '2026-08-24', status: 'done', value: { duration_min: 45 } }),
    ] as never);

    const facts = await buildWeekReviewFacts('u1', FROM, TO);
    const day = facts.days.find((d) => d.date === '2026-08-24')!;
    expect(day.sessions).toEqual([
      { occurrence_id: 'o1', title: 'Easy run', status: 'done', planned_min: 40, logged_min: 45 },
    ]);
  });

  it('places a system meal row into its slot, logged when done', async () => {
    vi.mocked(listActivities).mockResolvedValue([
      activity({ activity_id: 'a-lunch', kind: 'system', title: 'Log lunch', schedule: {} }),
    ] as never);
    vi.mocked(listOccurrences).mockResolvedValue([
      occ({ occurrence_id: 'o-lunch', activity_id: 'a-lunch', date: '2026-08-24', status: 'done' }),
    ] as never);

    const facts = await buildWeekReviewFacts('u1', FROM, TO);
    const day = facts.days.find((d) => d.date === '2026-08-24')!;
    expect(day.meals).toEqual([
      { meal: 'breakfast', occurrence_id: null, logged: false },
      { meal: 'lunch', occurrence_id: 'o-lunch', logged: true },
      { meal: 'dinner', occurrence_id: null, logged: false },
    ]);
  });

  it('never counts a system row toward sessions or mind, even unmatched', async () => {
    // A system row that names no meal (the weigh-in itself, or a future system row) must not leak
    // into either bucket — it's only ever reached through its own dedicated lookup.
    vi.mocked(listActivities).mockResolvedValue([
      activity({ activity_id: 'a-w', kind: 'system', title: 'Weigh-in', schedule: {} }),
    ] as never);
    vi.mocked(listOccurrences).mockResolvedValue([
      occ({ occurrence_id: 'o-w', activity_id: 'a-w', date: '2026-08-24', status: 'pending' }),
    ] as never);
    const facts = await buildWeekReviewFacts('u1', FROM, TO);
    const day = facts.days.find((d) => d.date === '2026-08-24')!;
    expect(day.sessions).toEqual([]);
    expect(day.mind).toEqual([]);
    expect(day.meals.every((m) => m.occurrence_id === null)).toBe(true);
  });

  it('routes a user occurrence linked to a mind/practice goal into mind rows, not sessions', async () => {
    vi.mocked(listGoals).mockResolvedValue([{ goal_id: 'g1', area: 'mind' }] as never);
    vi.mocked(listActivities).mockResolvedValue([
      activity({ activity_id: 'a1', kind: 'user', title: 'Morning practice', goal_id: 'g1', schedule: {} }),
    ] as never);
    vi.mocked(listOccurrences).mockResolvedValue([
      occ({ occurrence_id: 'o1', activity_id: 'a1', date: '2026-08-24', status: 'pending' }),
    ] as never);

    const facts = await buildWeekReviewFacts('u1', FROM, TO);
    const day = facts.days.find((d) => d.date === '2026-08-24')!;
    expect(day.sessions).toEqual([]);
    expect(day.mind).toHaveLength(1);
    expect(day.mind[0]!.title).toBe('Morning practice');
  });

  it('exposes named steps, seeded from the cached session and overlaid with the log', async () => {
    vi.mocked(listGoals).mockResolvedValue([{ goal_id: 'g1', area: 'practice' }] as never);
    vi.mocked(listActivities).mockResolvedValue([
      activity({ activity_id: 'a1', kind: 'user', title: 'Evening pages', goal_id: 'g1', schedule: {} }),
    ] as never);
    vi.mocked(listOccurrences).mockResolvedValue([
      occ({ occurrence_id: 'o1', activity_id: 'a1', date: '2026-08-24', status: 'pending' }),
    ] as never);
    vi.mocked(listOccurrenceSessionLogs).mockResolvedValue([
      {
        occurrence_id: 'o1',
        session: { blocks: [{ label: 'Practice', items: [{ name: 'Settle' }, { name: 'Write' }] }] },
        log: { items: [{ name: 'Settle', done: true }], summary: '', raw_text: '', logged_at: '2026-08-24T08:00:00Z' },
      },
    ] as never);

    const facts = await buildWeekReviewFacts('u1', FROM, TO);
    const row = facts.days.find((d) => d.date === '2026-08-24')!.mind[0]!;
    expect(row.steps).toEqual([
      { name: 'Settle', done: true },
      { name: 'Write', done: false }, // named by the session but never logged — defaults to not done
    ]);
    expect(row.done).toBeUndefined();
  });

  it('falls back to a plain done boolean when there is no cached session to name steps from', async () => {
    vi.mocked(listGoals).mockResolvedValue([{ goal_id: 'g1', area: 'mind' }] as never);
    vi.mocked(listActivities).mockResolvedValue([
      activity({ activity_id: 'a1', kind: 'user', title: 'Sit', goal_id: 'g1', schedule: {} }),
    ] as never);
    vi.mocked(listOccurrences).mockResolvedValue([
      occ({ occurrence_id: 'o1', activity_id: 'a1', date: '2026-08-24', status: 'done' }),
    ] as never);
    // listOccurrenceSessionLogs defaults to [] — no cached session for this occurrence.

    const facts = await buildWeekReviewFacts('u1', FROM, TO);
    const row = facts.days.find((d) => d.date === '2026-08-24')!.mind[0]!;
    expect(row.steps).toBeUndefined();
    expect(row.done).toBe(true);
  });

  it('carries the weigh-in as a week-level field, not a per-day row', async () => {
    vi.mocked(findWeighInOccurrence).mockResolvedValue({ occurrence_id: 'w1', date: '2026-08-25', status: 'pending' });
    const facts = await buildWeekReviewFacts('u1', FROM, TO);
    expect(facts.weigh_in).toEqual({ occurrence_id: 'w1', date: '2026-08-25', status: 'pending' });
    // And it never shows up inside a day's own buckets.
    expect(facts.days.every((d) => d.sessions.length === 0 && d.mind.length === 0)).toBe(true);
  });

  it("drops an occurrence whose activity is not in the active plan's current activity set", async () => {
    // Inherited from buildPlanView's own join: an occurrence from a superseded plan version has no
    // matching row in listActivities(plan.plan_id), so it can't resolve a title.
    vi.mocked(listActivities).mockResolvedValue([] as never);
    vi.mocked(listOccurrences).mockResolvedValue([occ({ activity_id: 'stale-activity' })] as never);
    const facts = await buildWeekReviewFacts('u1', FROM, TO);
    expect(facts.days.flatMap((d) => d.sessions)).toEqual([]);
  });

  // Progress Engine parcel W2-2: the additive, contract-shaped twins of `days` — the widget-shaping
  // math itself lives in week-review-widgets.test.ts (pure, exhaustive); this just asserts the
  // builder actually attaches both fields to what it returns.
  it('attaches rhythm_week and meals_week, built from the SAME days it returns', async () => {
    vi.mocked(listActivities).mockResolvedValue([
      activity({ activity_id: 'a1', kind: 'user', title: 'Easy run', schedule: {} }),
    ] as never);
    vi.mocked(listOccurrences).mockResolvedValue([
      occ({ occurrence_id: 'o1', activity_id: 'a1', date: '2026-08-24', status: 'done' }),
    ] as never);

    const facts = await buildWeekReviewFacts('u1', FROM, TO);
    expect(facts.rhythm_week).toMatchObject({ start: FROM, kept: 1, scheduled: 1 });
    expect(facts.meals_week?.weeks).toHaveLength(facts.days.length);
  });
});
