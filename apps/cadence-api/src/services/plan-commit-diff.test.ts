/**
 * The diff that decides which occurrences survive a commit (PLAN-CHANGES.md Phase 1). Pure
 * function, real assertions, no mocking — the fingerprint must cover exactly what generateSession
 * reads off the activity (title/kind as match key; category, schedule, target, how_to, goal_id
 * fingerprinted) and nothing prescriptions never see (why, suggested, completion_source).
 */
import { describe, expect, it } from 'vitest';
import type { Activity } from '@cadence/shared';
import { diffCommittedActivities, sessionFingerprint, type CommitDiffWindow } from './plan-commit-diff.ts';

/** Both anchors on the same Monday-week; parity-free recurrences behave identically under them. */
const WINDOW: CommitDiffWindow = {
  from: '2026-08-31',
  to: '2026-09-07',
  oldAnchor: '2026-08-24',
  newAnchor: '2026-08-31',
};

let seq = 0;
function act(over: Partial<Activity> = {}): Activity {
  seq += 1;
  return {
    activity_id: over.activity_id ?? `a-${seq}`,
    commitment_id: 'c1',
    plan_id: 'p1',
    goal_id: 'g1',
    title: 'Easy run',
    kind: 'user',
    category: 'run',
    schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', time_of_day: '06:30', duration_min: 40 },
    target: { metric: 'distance', value: 5, unit: 'km' },
    completion_source: 'self_report',
    why: 'builds your aerobic base',
    ...over,
  };
}

function survivorsOf(oldA: Activity[], newA: Activity[], window: CommitDiffWindow = WINDOW) {
  return diffCommittedActivities(oldA, newA, window).survivors;
}

describe('diffCommittedActivities — matching and fingerprint', () => {
  it('a byte-identical recommit survives every activity (zero invalidations)', () => {
    const olds = [act({ title: 'Easy run' }), act({ title: 'Mobility', schedule: { recurrence: 'FREQ=DAILY' } })];
    const news = [
      act({ title: 'Easy run', plan_id: 'p2' }),
      act({ title: 'Mobility', schedule: { recurrence: 'FREQ=DAILY' }, plan_id: 'p2' }),
    ];
    const diff = diffCommittedActivities(olds, news, WINDOW);
    expect(diff.survivors).toHaveLength(2);
    expect(diff.invalidated).toBe(0);
    expect(diff.survivors.map((s) => [s.oldActivityId, s.newActivityId])).toEqual([
      [olds[0]!.activity_id, news[0]!.activity_id],
      [olds[1]!.activity_id, news[1]!.activity_id],
    ]);
  });

  it('fields prescriptions never see do NOT invalidate: why, suggested, completion_source', () => {
    const olds = [act()];
    const news = [act({ why: 'totally reworded rationale', suggested: true, completion_source: 'healthkit' })];
    expect(survivorsOf(olds, news)).toHaveLength(1);
  });

  it('each session-affecting field invalidates on change', () => {
    const cases: Array<Partial<Activity>> = [
      { category: 'strength' },
      { schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE', time_of_day: '06:30', duration_min: 40 } },
      { schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', time_of_day: '18:00', duration_min: 40 } },
      { schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', time_of_day: '06:30', duration_min: 60 } },
      { target: { metric: 'distance', value: 8, unit: 'km' } },
      {
        target: {
          metric: 'distance',
          value: 5,
          unit: 'km',
          scheme: { quantity: 'distance_km', kind: 'linear', increment: 0.5 },
        },
      },
      { how_to: 'dead hangs, not farmers carries' },
      { goal_id: 'g2' },
    ];
    for (const change of cases) {
      expect(survivorsOf([act()], [act(change)]), JSON.stringify(change)).toHaveLength(0);
    }
  });

  it('title matching is trim/case-insensitive (inheritCommitmentIds convention)', () => {
    expect(survivorsOf([act({ title: 'Easy run' })], [act({ title: '  easy RUN ' })])).toHaveLength(1);
  });

  it('a same-titled activity that flips kind is a different thing — no pairing', () => {
    expect(survivorsOf([act({ kind: 'user' })], [act({ kind: 'system' })])).toHaveLength(0);
  });

  it('title collisions fall back to changed — on either side', () => {
    const twoOld = [act({ title: 'Easy run' }), act({ title: 'Easy run' })];
    expect(survivorsOf(twoOld, [act({ title: 'Easy run' })])).toHaveLength(0);
    const twoNew = [act({ title: 'Easy run' }), act({ title: 'Easy run' })];
    expect(survivorsOf([act({ title: 'Easy run' })], twoNew)).toHaveLength(0);
  });

  it('removed activities count as invalidated; added ones do not block the survivors', () => {
    const olds = [act({ title: 'Easy run' }), act({ title: 'Dropped thing' })];
    const news = [act({ title: 'Easy run' }), act({ title: 'Brand new thing' })];
    const diff = diffCommittedActivities(olds, news, WINDOW);
    expect(diff.survivors.map((s) => s.title)).toEqual(['Easy run']);
    expect(diff.invalidated).toBe(1);
  });

  it('null-vs-undefined and jsonb key order do not invalidate', () => {
    const olds = [
      act({
        goal_id: null as unknown as undefined, // what a SQL NULL actually comes back as
        how_to: null,
        target: { unit: 'km', value: 5, metric: 'distance' }, // different key order
        schedule: { recurrence: 'FREQ=DAILY', time_of_day: undefined },
      }),
    ];
    const news = [
      act({
        goal_id: undefined,
        how_to: undefined,
        target: { metric: 'distance', value: 5, unit: 'km' },
        schedule: { recurrence: 'FREQ=DAILY', time_of_day: '' as unknown as undefined },
      }),
    ];
    expect(survivorsOf(olds, news)).toHaveLength(1);
  });
});

describe('diffCommittedActivities — the anchor gate (a new plan version means a new recurrence anchor)', () => {
  const daily2 = (): Activity => act({ schedule: { recurrence: 'FREQ=DAILY;INTERVAL=2' } });

  it('an every-other-day whose parity FLIPS under the new anchor is treated as changed', () => {
    // 7 days between anchors — odd, so the "every other day" dates shift by one.
    expect(survivorsOf([daily2()], [daily2()], WINDOW)).toHaveLength(0);
  });

  it('the same every-other-day survives when the anchors agree on parity', () => {
    const w = { ...WINDOW, oldAnchor: '2026-08-17' }; // 14 days apart — parity preserved
    expect(survivorsOf([daily2()], [daily2()], w)).toHaveLength(1);
  });

  it('anchor-independent recurrences survive any anchor move (BYDAY weekly, plain daily)', () => {
    const weekly = () => act({ title: 'Runs', schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' } });
    const daily = () => act({ title: 'Sit', schedule: { recurrence: 'FREQ=DAILY' } });
    const w = { ...WINDOW, oldAnchor: '2026-08-13' };
    expect(survivorsOf([weekly(), daily()], [weekly(), daily()], w)).toHaveLength(2);
  });

  it('a weekly with NO BYDAY defaults to the anchor weekday — different weekdays means changed', () => {
    const weekly = (): Activity => act({ schedule: { recurrence: 'FREQ=WEEKLY' } });
    // 2026-08-24 (Mon) vs 2026-08-31 (Mon): same weekday, survives.
    expect(survivorsOf([weekly()], [weekly()], WINDOW)).toHaveLength(1);
    // 2026-08-25 (Tue) vs 2026-08-31 (Mon): the default weekday moved, changed.
    expect(survivorsOf([weekly()], [weekly()], { ...WINDOW, oldAnchor: '2026-08-25' })).toHaveLength(0);
  });

  it('an empty recurrence (never materialized — the off-plan bucket shape) may survive: no dates, no ghosts', () => {
    const bucket = (): Activity => act({ kind: 'system', schedule: { recurrence: '' }, target: undefined });
    expect(survivorsOf([bucket()], [bucket()])).toHaveLength(1);
  });
});

describe('sessionFingerprint', () => {
  it('is stable across key order and missing-vs-null optionals', () => {
    const a = sessionFingerprint({
      category: 'run',
      schedule: { recurrence: 'FREQ=DAILY', duration_min: 40, time_of_day: '06:30' },
      target: { metric: 'distance', value: 5 },
    });
    const b = sessionFingerprint({
      category: 'run',
      how_to: null,
      goal_id: undefined,
      schedule: { time_of_day: '06:30', recurrence: 'FREQ=DAILY', duration_min: 40 },
      target: { value: 5, metric: 'distance' },
    });
    expect(a).toBe(b);
  });

  it('distinguishes a scheme change buried deep in target', () => {
    const base = { schedule: { recurrence: 'FREQ=DAILY' } };
    const a = sessionFingerprint({
      ...base,
      target: { metric: 'load', value: 50, scheme: { quantity: 'load', kind: 'linear', increment: 5 } },
    });
    const b = sessionFingerprint({
      ...base,
      target: { metric: 'load', value: 50, scheme: { quantity: 'load', kind: 'linear', increment: 10 } },
    });
    expect(a).not.toBe(b);
  });
});
