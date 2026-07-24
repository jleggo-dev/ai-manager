import { describe, it, expect } from 'vitest';
import { actualWeeklyRate, safeWeeklyKg, classifyLossPace } from './weight-trend.ts';

describe('actualWeeklyRate', () => {
  it('computes signed kg/week from earliest to latest', () => {
    expect(
      actualWeeklyRate([
        { date: '2026-01-01', kg: 90 },
        { date: '2026-01-15', kg: 89 },
      ]),
    ).toBeCloseTo(-0.5, 5); // lost 1 kg over 14 days
  });

  it('is order-independent (sorts by date)', () => {
    expect(
      actualWeeklyRate([
        { date: '2026-01-15', kg: 89 },
        { date: '2026-01-01', kg: 90 },
      ]),
    ).toBeCloseTo(-0.5, 5);
  });

  it('needs ≥2 points spanning ≥1 week', () => {
    expect(actualWeeklyRate([{ date: '2026-01-01', kg: 90 }])).toBeNull();
    expect(
      actualWeeklyRate([
        { date: '2026-01-01', kg: 90 },
        { date: '2026-01-04', kg: 89 },
      ]),
    ).toBeNull(); // only 3 days
  });
});

describe('safeWeeklyKg', () => {
  it('is ~0.75% of bodyweight per week', () => {
    expect(safeWeeklyKg(88)).toBe(0.66);
    expect(safeWeeklyKg(100)).toBe(0.75);
  });
});

describe('classifyLossPace', () => {
  const safe = 0.66;
  it('flags too fast, too slow, and on track', () => {
    expect(classifyLossPace(-1.2, safe)).toBe('too_fast'); // 1.2 > 1.5×0.66
    expect(classifyLossPace(-0.2, safe)).toBe('too_slow'); // 0.2 < 0.5×0.66
    expect(classifyLossPace(-0.5, safe)).toBe('on_track');
    expect(classifyLossPace(0.3, safe)).toBe('too_slow'); // gaining while trying to lose
  });
});
