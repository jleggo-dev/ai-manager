import { describe, it, expect } from 'vitest';
import type { Goal, EquipmentWear } from '@cadence/shared';
import { evaluateGuardrail, goalLoad } from './goal-guardrail.ts';
import { budgetTier } from './token-budget.ts';
import { parseRecurrence, expandRecurrence, describeRecurrence } from './scheduling.ts';
import { wearStatus, applyRun } from './shoe-mileage.ts';
import { detectTripwires, haversineKm } from './tripwires.ts';

type GoalLite = Pick<Goal, 'area' | 'type' | 'status'>;

describe('goal-guardrail (§6.2/§A1)', () => {
  it('weights contemplative areas cheaper than training blocks', () => {
    expect(goalLoad({ area: 'practice', type: 'recurring' })).toBe(1);
    expect(goalLoad({ area: 'mind', type: 'milestone' })).toBe(1);
    expect(goalLoad({ area: 'nourishment', type: 'recurring' })).toBe(2);
    expect(goalLoad({ area: 'movement', type: 'milestone' })).toBe(3);
  });

  it('trips the focus budget on weighted load, not raw count', () => {
    const practices: GoalLite[] = Array.from({ length: 7 }, () => ({
      area: 'practice',
      type: 'recurring',
      status: 'confirmed',
    }));
    const v = evaluateGuardrail(practices); // 7 practices → load 7 > budget 6
    expect(v.activeCount).toBe(7);
    expect(v.weightedLoad).toBe(7);
    expect(v.overFocusBudget).toBe(true);
    expect(v.exceedsHardCap).toBe(false);
  });

  it('lets a healthy mixed starting set through (race + two gentle habits)', () => {
    const set: GoalLite[] = [
      { area: 'movement', type: 'target', status: 'confirmed' }, // 3
      { area: 'mind', type: 'recurring', status: 'confirmed' }, // 1
      { area: 'practice', type: 'recurring', status: 'confirmed' }, // 1
    ];
    const v = evaluateGuardrail(set); // load 5 ≤ budget 6
    expect(v.weightedLoad).toBe(5);
    expect(v.overFocusBudget).toBe(false);
  });

  it('excludes parked/completed goals from active count', () => {
    const goals: GoalLite[] = [
      { area: 'movement', type: 'milestone', status: 'parked' },
      { area: 'movement', type: 'milestone', status: 'completed' },
    ];
    expect(evaluateGuardrail(goals).activeCount).toBe(0);
  });
});

describe('token-budget (§4.3)', () => {
  it('maps usage ratio to green/amber/red', () => {
    expect(budgetTier(10, 100)).toBe('green');
    expect(budgetTier(70, 100)).toBe('amber');
    expect(budgetTier(90, 100)).toBe('red');
  });
});

describe('scheduling (§5.4)', () => {
  it('parses FREQ=WEEKLY;BYDAY=MO,WE,FR', () => {
    const p = parseRecurrence('FREQ=WEEKLY;BYDAY=MO,WE,FR');
    expect(p.freq).toBe('WEEKLY');
    expect(p.byday).toEqual([1, 3, 5]);
  });

  it('expands weekly BYDAY over a range (2026-06-29 is a Monday)', () => {
    const dates = expandRecurrence('FREQ=WEEKLY;BYDAY=MO,WE,FR', '2026-06-29', '2026-07-05');
    expect(dates).toEqual(['2026-06-29', '2026-07-01', '2026-07-03']);
  });

  it('expands daily inclusively', () => {
    expect(expandRecurrence('FREQ=DAILY', '2026-06-29', '2026-07-01')).toEqual([
      '2026-06-29',
      '2026-06-30',
      '2026-07-01',
    ]);
  });

  it('every other day fires on alternating dates from the anchor', () => {
    expect(expandRecurrence('FREQ=DAILY;INTERVAL=2', '2026-06-29', '2026-07-05', '2026-06-29')).toEqual([
      '2026-06-29',
      '2026-07-01',
      '2026-07-03',
      '2026-07-05',
    ]);
  });

  it('every-other-day parity stays STABLE when the horizon is topped up later', () => {
    // Same anchor (06-29), but a later rolling window [07-06..07-10] — must keep the same parity.
    expect(expandRecurrence('FREQ=DAILY;INTERVAL=2', '2026-07-06', '2026-07-10', '2026-06-29')).toEqual([
      '2026-07-07',
      '2026-07-09',
    ]);
  });

  it('every other week fires on the weekday in alternating weeks', () => {
    expect(expandRecurrence('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', '2026-06-29', '2026-07-27', '2026-06-29')).toEqual([
      '2026-06-29',
      '2026-07-13',
      '2026-07-27',
    ]);
  });

  it('monthly fires on BYMONTHDAY dates', () => {
    expect(expandRecurrence('FREQ=MONTHLY;BYMONTHDAY=1,15', '2026-07-01', '2026-08-31', '2026-06-29')).toEqual([
      '2026-07-01',
      '2026-07-15',
      '2026-08-01',
      '2026-08-15',
    ]);
  });

  it('bare weekly fires only on the anchor weekday (not every day)', () => {
    // 2026-06-29 is a Monday → weekly with no BYDAY means Mondays only.
    expect(expandRecurrence('FREQ=WEEKLY', '2026-06-29', '2026-07-05', '2026-06-29')).toEqual(['2026-06-29']);
  });

  it('describes cadences for the UI', () => {
    expect(describeRecurrence('FREQ=DAILY;INTERVAL=2')).toBe('Every other day');
    expect(describeRecurrence('FREQ=WEEKLY;BYDAY=MO,WE,FR')).toBe('Mon, Wed, Fri');
    expect(describeRecurrence('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO')).toBe('Every other week · Mon');
    expect(describeRecurrence('FREQ=MONTHLY;BYMONTHDAY=1,15')).toBe('Monthly · days 1, 15');
    expect(describeRecurrence('FREQ=DAILY')).toBe('Every day');
  });
});

describe('shoe-mileage (§5.3)', () => {
  it('flags retire_soon past ~85% and retired at threshold', () => {
    expect(wearStatus(500, 600)).toBe('active');
    expect(wearStatus(540, 600)).toBe('retire_soon');
    expect(wearStatus(600, 600)).toBe('retired');
  });

  it('accumulates a run onto the active shoe', () => {
    const wear: EquipmentWear = {
      tracks_mileage: true,
      accumulated_km: 412,
      threshold_km: 600,
      auto_sum_from: 'healthkit_runs',
      status: 'active',
    };
    const next = applyRun(wear, 5.2);
    expect(next.accumulated_km).toBe(417.2);
    expect(next.status).toBe('active');
  });
});

describe('tripwires (§B4)', () => {
  it('returns [] when nothing trips (no Broker call needed)', () => {
    expect(detectTripwires({})).toEqual([]);
  });

  it('detects timezone shift + consistency/outcome divergence', () => {
    const fired = detectTripwires({
      homeTimezoneOffsetMin: 0,
      currentTimezoneOffsetMin: 360,
      consistencyRate: 0.9,
      outcomeDelta: 0,
    });
    expect(fired).toContain('timezone_shift');
    expect(fired).toContain('consistency_outcome_divergence');
  });

  it('haversine approximates a known distance (NYC→LA ≈ 3936 km)', () => {
    const km = haversineKm(40.71, -74.01, 34.05, -118.24);
    expect(km).toBeGreaterThan(3800);
    expect(km).toBeLessThan(4100);
  });
});
