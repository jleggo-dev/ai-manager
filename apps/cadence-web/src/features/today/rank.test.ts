import { describe, it, expect } from 'vitest';
import type { ProgressCard } from '@cadence/shared';
import { rankProgressCard } from './rank.ts';

function card(partial: ProgressCard): ProgressCard {
  return partial;
}

describe('rankProgressCard', () => {
  it('orders movement consistency before counts before practice consistency', () => {
    const movement = card({ kind: 'consistency', area: 'movement', title: 'm', kept: 1, window: 7 });
    const count = card({
      kind: 'count',
      area: 'mind',
      title: 'c',
      goal_id: 'g1',
      current: 1,
      target: 10,
      unit: 'books',
    });
    const practice = card({ kind: 'consistency', area: 'practice', title: 'p', kept: 2, window: 7 });
    const measured = card({
      kind: 'latest_vs_target',
      area: 'movement',
      title: 'w',
      unit: 'kg',
      latest: 80,
      start: 85,
      target: 75,
      series: [],
    });
    const countdown = card({
      kind: 'countdown',
      area: 'mind',
      title: 'race',
      end: '2026-09-01',
      days_left: 40,
      milestones_done: 1,
      milestones_total: 3,
    });

    const ranked = [countdown, measured, practice, count, movement].sort(
      (a, b) => rankProgressCard(a) - rankProgressCard(b),
    );
    expect(ranked.map((c) => c.kind + (c.kind === 'consistency' ? `:${c.area}` : ''))).toEqual([
      'consistency:movement',
      'count',
      'consistency:practice',
      'latest_vs_target',
      'countdown',
    ]);
  });
});
