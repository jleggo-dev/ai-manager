/**
 * The plain version built when the coach cannot be reached — a table, because each rule is a
 * router: the wrong shape opens the wrong tool and nothing throws. Positives and near-misses for
 * every rule; the prior-session path and the "nothing fits" null beside them.
 */
import { describe, expect, it } from 'vitest';
import type { OccurrenceSession } from '@cadence/shared';
import type { OccurrenceWithActivity } from '../repos/occurrences.ts';
import { FALLBACK_NOTE, buildFallbackSession, plainItemFor } from './session-fallback.ts';

const NOW = '2026-10-29T12:00:00.000Z';

function occ(over: Partial<OccurrenceWithActivity> = {}): OccurrenceWithActivity {
  return {
    occurrence_id: 'o1',
    activity_id: 'a1',
    date: '2026-10-29',
    status: 'pending',
    kind: 'user',
    title: 'Upper body',
    category: 'strength',
    schedule: { recurrence: 'weekly', duration_min: 40 },
    target: null,
    session: null,
    log: null,
    ...over,
  } as OccurrenceWithActivity;
}

const prior = (over: Partial<OccurrenceSession> = {}): { date: string; session: OccurrenceSession } => ({
  date: '2026-10-22',
  session: {
    blocks: [{ label: 'Main', items: [{ name: 'Press', sets: 3, reps: 10, load: '50 lb' }] }],
    note: 'Last week: a touch more than before.',
    generated_at: '2026-10-22T00:00:00.000Z',
    version: 2,
    ...over,
  },
});

describe('plainItemFor — one block from the activity’s own shape', () => {
  it.each<[string, Partial<OccurrenceWithActivity>, Record<string, unknown> | null]>([
    ['a length → a timer', {}, { tool: 'timer', duration_min: 40 }],
    [
      'a mind category → a sit',
      { category: 'mind', title: 'Evening stillness' },
      { tool: 'meditate', duration_min: 40 },
    ],
    ['a meditation title → a sit', { category: null, title: 'Morning meditation' }, { tool: 'meditate' }],
    [
      'a journal title → a page',
      { title: 'Gratitude journal', schedule: { recurrence: 'daily', duration_min: 10 } },
      { tool: 'journal', duration_min: 10 },
    ],
    [
      'a rep target → reps, even on a mind row',
      { category: 'mind', target: { metric: 'reps', value: 20 } },
      { tool: 'reps', sets: 1, reps: 20 },
    ],
    ['a km target → the distance', { target: { metric: 'distance_km', value: 5 }, schedule: null }, { distance_km: 5 }],
    [
      'a mile target → converted',
      { target: { metric: 'distance', value: 2, unit: 'mi' }, schedule: null },
      { distance_km: 3.22 },
    ],
    [
      'a snake_case mile metric → converted',
      { target: { metric: 'distance_mi', value: 3 }, schedule: null },
      { distance_km: 4.83 },
    ],
    [
      '"minutes" is not miles',
      { target: { metric: 'minutes', value: 25 }, schedule: null },
      { tool: 'timer', duration_min: 25 },
    ],
    [
      'a minutes target beats the schedule length',
      { target: { metric: 'minutes', value: 25 } },
      { tool: 'timer', duration_min: 25 },
    ],
    ['a sessions-per-week target is not a length', { target: { metric: 'sessions', value: 3 }, schedule: null }, null],
    ['no length and no target → nothing', { schedule: null }, null],
    ['a zero length → nothing', { schedule: { recurrence: 'daily', duration_min: 0 } }, null],
    ['"Sit-ups" is not a sit', { title: 'Sit-ups', category: 'strength' }, { tool: 'timer' }],
  ])('%s', (_name, over, expected) => {
    const item = plainItemFor(occ(over));
    if (expected === null) expect(item).toBeNull();
    else expect(item).toMatchObject({ name: occ(over).title, ...expected });
  });
});

describe('buildFallbackSession', () => {
  it('carries the last session of this title forward as it was, marked and re-noted', () => {
    const s = buildFallbackSession(occ(), prior(), false, NOW);
    expect(s).toMatchObject({
      fallback: 'coach_unreachable',
      note: FALLBACK_NOTE,
      generated_at: NOW,
      version: 3,
      blocks: [{ label: 'Main', items: [{ name: 'Press', sets: 3, reps: 10, load: '50 lb' }] }],
    });
  });

  it('progresses it when the activity carries a scheme (deterministic mode)', () => {
    const scheme = { quantity: 'load', step_pct: 5 } as never;
    const s = buildFallbackSession(occ({ target: { metric: 'load', value: 50, scheme } }), prior(), false, NOW);
    expect(s?.fallback).toBe('coach_unreachable');
    expect(s?.note).toBe(FALLBACK_NOTE);
    // One week on, the load moved; the movement did not.
    expect(s?.blocks[0]?.items[0]?.name).toBe('Press');
    expect(s?.blocks[0]?.items[0]?.load).not.toBe('50 lb');
  });

  it('holds the numbers when the last one was missed', () => {
    const scheme = { quantity: 'load', step_pct: 5 } as never;
    const s = buildFallbackSession(occ({ target: { metric: 'load', value: 50, scheme } }), prior(), true, NOW);
    expect(s?.blocks[0]?.items[0]?.load).toBe('50 lb');
  });

  it('ignores a prior with no blocks and falls through to the shape', () => {
    const s = buildFallbackSession(occ(), prior({ blocks: [] }), false, NOW);
    expect(s?.blocks).toEqual([{ label: 'Today', items: [{ name: 'Upper body', tool: 'timer', duration_min: 40 }] }]);
    expect(s?.fallback).toBe('coach_unreachable');
  });

  it('is null when there is no prior and the activity has no shape', () => {
    expect(buildFallbackSession(occ({ schedule: null }), null, false, NOW)).toBeNull();
  });
});
