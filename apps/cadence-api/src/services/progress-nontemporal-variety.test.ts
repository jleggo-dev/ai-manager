import { describe, it, expect } from 'vitest';
import type { NutritionLog } from '@cadence/shared';
import { resolveVariety } from './progress-nontemporal-variety.ts';

function log(meal: NutritionLog['meal'], items: NutritionLog['items']): NutritionLog {
  return {
    log_id: 'zzq-log',
    date: '2026-08-15',
    meal,
    items,
    macros: {},
    input_method: 'text',
  };
}

describe('resolveVariety', () => {
  it('omits with evidence when there are no logs for that meal in the window', () => {
    expect(resolveVariety([], 'dinner', 'this month')).toEqual({
      id: 'variety:dinner',
      kind: 'variety',
      reason: 'no dinner logs in this window',
    });
  });

  it('counts distinct foods by food_id when present', () => {
    const logs = [
      log('dinner', [{ name: 'Salmon', food_id: 'food-1' }]),
      log('dinner', [{ name: 'Salmon', food_id: 'food-1' }]), // repeat — same food twice, not two
      log('dinner', [{ name: 'Chicken', food_id: 'food-2' }]),
    ];
    expect(resolveVariety(logs, 'dinner', 'this month')).toEqual({ count: 2, noun: 'different dinners', window_label: 'this month' });
  });

  it('falls back to name when food_id is absent (free-form logs)', () => {
    const logs = [log('dinner', [{ name: 'Homemade chili' }]), log('dinner', [{ name: 'homemade chili' }])];
    expect(resolveVariety(logs, 'dinner', 'this month')).toEqual({ count: 1, noun: 'different dinners', window_label: 'this month' });
  });

  it('only counts the requested meal slot — a lunch log never inflates the dinner count', () => {
    const logs = [log('dinner', [{ name: 'Salmon', food_id: 'food-1' }]), log('lunch', [{ name: 'Salad', food_id: 'food-9' }])];
    expect(resolveVariety(logs, 'dinner', 'this month')).toEqual({ count: 1, noun: 'different dinners', window_label: 'this month' });
  });

  it('sums distinct foods across multi-item meals', () => {
    const logs = [log('dinner', [{ name: 'Salmon', food_id: 'food-1' }, { name: 'Rice', food_id: 'food-2' }])];
    expect(resolveVariety(logs, 'dinner', 'this month')).toEqual({ count: 2, noun: 'different dinners', window_label: 'this month' });
  });
});
