import { describe, it, expect } from 'vitest';
import {
  DEFAULT_POINTS_PARAMS,
  advancePoints,
  initialPointsState,
  pointsForDay,
  pointsForWeekMinutes,
  redeemFreeze,
  streakDayBonus,
  type DayPoints,
} from './points.ts';

const P = DEFAULT_POINTS_PARAMS; // perTask 10, dayCompleteBonus 20, minutesPerPoint 10, streakDayBonusCap 10, freezeCost 100

describe('streakDayBonus', () => {
  it('scales with streak length but is capped', () => {
    expect(streakDayBonus(0)).toBe(0);
    expect(streakDayBonus(6)).toBe(6);
    expect(streakDayBonus(10)).toBe(10);
    expect(streakDayBonus(40)).toBe(10); // capped
  });
});

describe('pointsForDay', () => {
  it('awards per-task base + a completed-day bonus + the streak bonus', () => {
    // 3 tasks done of 3 due, on a 5-day streak: 30 + 20 + 5
    expect(pointsForDay({ date: '2026-07-26', tasksDone: 3, tasksDue: 3, streakAfter: 5 }, P)).toBe(55);
  });

  it('withholds the completed-day bonus on a partial day', () => {
    // 2 of 3 done, streak 5: 20 + 0 + 5
    expect(pointsForDay({ date: '2026-07-26', tasksDone: 2, tasksDue: 3, streakAfter: 5 }, P)).toBe(25);
  });

  it('gives no completed-day bonus when nothing was due', () => {
    // a rest day with an off-plan log: 1 task done, 0 due, no streak: just the base
    expect(pointsForDay({ date: '2026-07-26', tasksDone: 1, tasksDue: 0, streakAfter: 0 }, P)).toBe(10);
  });
});

describe('pointsForWeekMinutes', () => {
  it('earns effort points by the floor of active minutes', () => {
    expect(pointsForWeekMinutes(0)).toBe(0);
    expect(pointsForWeekMinutes(95)).toBe(9); // 95 / 10
    expect(pointsForWeekMinutes(-5)).toBe(0);
  });
});

describe('advancePoints', () => {
  it('folds finalized days into balance + lifetime and moves the watermark', () => {
    const days: DayPoints[] = [
      { date: '2026-07-25', tasksDone: 2, tasksDue: 2, streakAfter: 4 }, // 20 + 20 + 4 = 44
      { date: '2026-07-26', tasksDone: 1, tasksDue: 2, streakAfter: 0 }, // 10 + 0 + 0 = 10
    ];
    const s = advancePoints(initialPointsState(), days, P);
    expect(s.balance).toBe(54);
    expect(s.lifetime).toBe(54);
    expect(s.last_evaluated).toBe('2026-07-26');
  });

  it('is a no-op on an empty tail (forward-only, idempotent)', () => {
    const prior = { balance: 54, lifetime: 54, last_evaluated: '2026-07-26' };
    expect(advancePoints(prior, [], P)).toEqual(prior);
  });

  it('spends balance but never lifetime — redeem is separate from the fold', () => {
    const s = advancePoints(
      initialPointsState(),
      [{ date: '2026-07-26', tasksDone: 12, tasksDue: 12, streakAfter: 10 }],
      P,
    );
    expect(s.balance).toBe(s.lifetime); // 120 + 20 + 10 = 150
    expect(s.balance).toBe(150);
  });
});

describe('redeemFreeze', () => {
  it('spends freezeCost points to bank a freeze', () => {
    expect(redeemFreeze(150, 0, 2, P)).toEqual({ ok: true, balance: 50, freezes: 1 });
  });

  it('refuses when the wallet cannot afford it', () => {
    expect(redeemFreeze(80, 0, 2, P)).toEqual({ ok: false, reason: 'insufficient_points', balance: 80, freezes: 0 });
  });

  it('refuses when already at the freeze cap (over-banking is forfeited)', () => {
    expect(redeemFreeze(500, 2, 2, P)).toEqual({ ok: false, reason: 'freezes_full', balance: 500, freezes: 2 });
  });
});
