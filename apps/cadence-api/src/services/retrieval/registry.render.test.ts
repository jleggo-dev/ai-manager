/**
 * Pure render/rows coverage for the retrieval semantic layer (API-P2).
 * Mocks repo/DB imports so CI never needs CADENCE_* env — fixtures only.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ProgressCard } from '@cadence/shared';

vi.mock('../../repos/users.ts', () => ({ getUser: vi.fn() }));
vi.mock('../../repos/goals.ts', () => ({ listGoalsByStatus: vi.fn() }));
vi.mock('../../repos/equipment.ts', () => ({ listEquipment: vi.fn() }));
vi.mock('../../repos/plans.ts', () => ({ getActivePlan: vi.fn() }));
vi.mock('../../repos/activities.ts', () => ({ listActivities: vi.fn() }));
vi.mock('../../repos/occurrences.ts', () => ({ listOccurrences: vi.fn(), listRecentLogged: vi.fn() }));
vi.mock('../../repos/nutrition.ts', () => ({ listNutritionLogs: vi.fn() }));
vi.mock('../progress.ts', () => ({ buildProgress: vi.fn() }));
vi.mock('../nutrition-summarize.ts', async (orig) => {
  const real = await orig<typeof import('../nutrition-summarize.ts')>();
  return real;
});

import { RETRIEVAL_FUNCTIONS } from './registry.ts';

describe('retrieval registry — render / rows', () => {
  it('get_identity asks for a name when missing', () => {
    expect(RETRIEVAL_FUNCTIONS.get_identity!.render({ name: null })).toMatch(/ask the user their name/);
    expect(RETRIEVAL_FUNCTIONS.get_identity!.rows({ name: null })).toBe(0);
    expect(RETRIEVAL_FUNCTIONS.get_identity!.render({ name: 'Alex' })).toBe('Name: Alex');
    expect(RETRIEVAL_FUNCTIONS.get_identity!.rows({ name: 'Alex' })).toBe(1);
  });

  it('get_objectives formats measure + status (committed, not locked)', () => {
    const goals = [
      {
        title: 'First 10k',
        area: 'movement',
        type: 'milestone',
        status: 'committed',
        measure: { target: 10, unit: 'km' },
      },
    ];
    const text = RETRIEVAL_FUNCTIONS.get_objectives!.render(goals);
    expect(text).toContain('Objectives (1)');
    expect(text).toContain('First 10k');
    expect(text).toContain('committed');
    expect(text).toContain('target 10 km');
    expect(RETRIEVAL_FUNCTIONS.get_objectives!.rows(goals)).toBe(1);
    expect(RETRIEVAL_FUNCTIONS.get_objectives!.render([])).toBe('');
  });

  it('get_objectives catalog description uses committed (not locked)', () => {
    expect(RETRIEVAL_FUNCTIONS.get_objectives!.description).toMatch(/committed/);
    expect(RETRIEVAL_FUNCTIONS.get_objectives!.description).not.toMatch(/locked/);
  });

  it('get_active_plan omits when no plan', () => {
    expect(RETRIEVAL_FUNCTIONS.get_active_plan!.render({ plan: null, activities: [] })).toBe('');
    const text = RETRIEVAL_FUNCTIONS.get_active_plan!.render({
      plan: { version: 2 },
      activities: [{ kind: 'run', title: 'Easy run', schedule: { recurrence: '3x/week' } }],
    });
    expect(text).toContain('Current plan v2');
    expect(text).toContain('Easy run');
    expect(text).toContain('3x/week');
  });

  it('get_consistency omits when nothing scheduled', () => {
    expect(RETRIEVAL_FUNCTIONS.get_consistency!.render({ days: 7, scheduled: 0, done: 0, pct: null })).toBe('');
    expect(RETRIEVAL_FUNCTIONS.get_consistency!.render({ days: 7, scheduled: 4, done: 2, pct: 50 })).toBe(
      'Consistency (last 7d): 50% (2/4 showed up)',
    );
  });

  it('get_goal_progress covers each ProgressCard kind + trends', () => {
    const cards: ProgressCard[] = [
      { kind: 'count', area: 'mind', title: 'Books', goal_id: 'g1', current: 3, target: 12, unit: 'books' },
      {
        kind: 'latest_vs_target',
        area: 'nourishment',
        title: 'Weight',
        unit: 'kg',
        latest: 80,
        start: 90,
        target: 75,
        series: [],
      },
      {
        kind: 'countdown',
        area: 'movement',
        title: 'Race',
        end: '2026-09-01',
        days_left: 40,
        milestones_done: 1,
        milestones_total: 3,
      },
      { kind: 'consistency', area: 'practice', title: 'Prayer', kept: 4, window: 7 },
    ];
    const trends = [{ title: 'Squat', label: 'Top load', unit: 'kg', first: { value: 60 }, last: { value: 80 } }];
    const text = RETRIEVAL_FUNCTIONS.get_goal_progress!.render({ cards, trends });
    expect(text).toContain('3/12 books');
    expect(text).toContain('now 80 kg');
    expect(text).toContain('40 days out');
    expect(text).toContain('showed up 4 of 7 days');
    expect(text).toContain('60 → 80 kg');
    expect(RETRIEVAL_FUNCTIONS.get_goal_progress!.rows({ cards, trends })).toBe(5);
  });

  it('get_constraints prefers label and marks plan-around', () => {
    const text = RETRIEVAL_FUNCTIONS.get_constraints!.render([
      { label: 'left knee', plan_around: true },
      { area: 'shoulder', condition: 'sore', plan_around: false },
    ]);
    expect(text).toBe('What we work around: left knee [plan-around]; shoulder — sore');
  });

  it('get_equipment includes wear when present', () => {
    expect(RETRIEVAL_FUNCTIONS.get_equipment!.render([])).toBe('');
    expect(
      RETRIEVAL_FUNCTIONS.get_equipment!.render([
        { name: 'Pegasus', wear: { accumulated_km: 120, threshold_km: 500, status: 'ok' } },
      ]),
    ).toBe('Equipment: Pegasus (120/500km ok)');
  });

  it('get_weight omits without current', () => {
    expect(RETRIEVAL_FUNCTIONS.get_weight!.render(null)).toBe('');
    expect(RETRIEVAL_FUNCTIONS.get_weight!.render({ current: 82.5, start: 90 })).toBe('Weight: 82.5kg (start 90)');
  });

  it('get_food_log empty vs recent meals', () => {
    expect(
      RETRIEVAL_FUNCTIONS.get_food_log!.render({
        meals: [],
        summary: {
          window_days: 7,
          days_logged: 0,
          meals_logged: 0,
          meals_per_logged_day: 0,
          top_items: [],
          alcohol_days: 0,
          caffeine_days: 0,
        },
      }),
    ).toBe('Food log: nothing logged in the last 7 days.');
    const meals = [
      {
        date: '2026-07-18',
        meal: 'lunch',
        items: [{ name: 'salad' }],
        raw_text: null,
      },
    ];
    const summary = {
      window_days: 7,
      days_logged: 1,
      meals_logged: 1,
      meals_per_logged_day: 1,
      top_items: [{ name: 'salad', count: 1 }],
      alcohol_days: 0,
      caffeine_days: 0,
    };
    const text = RETRIEVAL_FUNCTIONS.get_food_log!.render({ meals, summary });
    expect(text).toContain('salad');
    expect(text).toContain('2026-07-18 lunch');
  });

  it('get_recent_logs formats felt notes', () => {
    const rows = [
      {
        date: '2026-07-17',
        title: 'Easy run',
        log: { summary: '5k easy', items: [{ felt: 'good' }] },
      },
    ];
    expect(RETRIEVAL_FUNCTIONS.get_recent_logs!.render(rows)).toBe(
      'Recent session reports:\n- 2026-07-17 · Easy run: 5k easy (felt good)',
    );
  });
});
