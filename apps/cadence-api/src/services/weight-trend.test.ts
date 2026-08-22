import { describe, it, expect } from 'vitest';
import {
  actualWeeklyRate,
  safeWeeklyKg,
  classifyLossPace,
  smoothedSeries,
  smoothedWeeklyRate,
  trendConfidence,
  trendWeightKg,
  type WeighPoint,
} from './weight-trend.ts';

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

/**
 * A23 §2a — the trend, not the number. The owner's own framing: week over week you cannot read
 * much into a scale, month over month you can. These pin that a single water-weight morning stops
 * being able to swing the read, which is what makes a daily weigh-in survivable.
 */
describe('smoothedSeries / smoothedWeeklyRate', () => {
  /** Weekly weigh-ins, losing a steady 0.5 kg/wk. */
  const steady: WeighPoint[] = [
    { date: '2026-07-01', kg: 90 },
    { date: '2026-07-08', kg: 89.5 },
    { date: '2026-07-15', kg: 89 },
    { date: '2026-07-22', kg: 88.5 },
    { date: '2026-07-29', kg: 88 },
  ];

  it('follows a steady loss without inventing one', () => {
    const rate = smoothedWeeklyRate(steady);
    expect(rate).not.toBeNull();
    expect(rate!).toBeGreaterThan(-0.6);
    expect(rate!).toBeLessThan(-0.2);
  });

  it('reads a flat series as flat', () => {
    const flat = steady.map((p) => ({ ...p, kg: 90 }));
    expect(smoothedWeeklyRate(flat)).toBeCloseTo(0, 2);
  });

  it('keeps more of the truth than first-to-last when one morning is bloated', () => {
    const truth = smoothedWeeklyRate(steady)!; // the real trend: about -0.5 kg/wk
    const spiked = [...steady.slice(0, 4), { date: '2026-07-29', kg: 89.6 }]; // +1.6kg of water
    const raw = actualWeeklyRate(spiked)!;
    const smooth = smoothedWeeklyRate(spiked)!;

    // First-to-last hands the spike total leverage and reads a steady loss as a near-stall —
    // which, fed to the adaptive loop, is a calorie cut nobody needed.
    expect(raw).toBeGreaterThan(-0.15);
    // The fit keeps the earlier weeks in evidence, so it lands closer to the truth. Neither is
    // immune; the point is that one bad morning stops being the whole story.
    expect(smooth).toBeLessThan(raw);
    expect(Math.abs(smooth - truth)).toBeLessThan(Math.abs(raw - truth));
  });

  it('weights by elapsed days, so a gap is not just another step', () => {
    const gappy: WeighPoint[] = [
      { date: '2026-07-01', kg: 90 },
      { date: '2026-07-02', kg: 88 },
    ];
    const spread: WeighPoint[] = [
      { date: '2026-07-01', kg: 90 },
      { date: '2026-08-01', kg: 88 },
    ];
    const nextDay = smoothedSeries(gappy)[1]!.kg;
    const nextMonth = smoothedSeries(spread)[1]!.kg;
    // A month later the new reading should dominate; a day later it should barely register.
    expect(nextDay).toBeGreaterThan(89.5);
    expect(nextMonth).toBeLessThan(88.5);
  });

  /**
   * REGRESSION GUARD (2026-08-22). The fit used to run over the EWMA-smoothed series, and an EWMA
   * lags a sustained trend — so at five weekly weigh-ins it reported a rate 34% too shallow, and
   * only converged after about thirteen. A23 §3 turns this number into calories at 7700/kg, so
   * that attenuation was ~190 kcal/day of wrong maintenance, biased toward "you are eating at
   * maintenance". The fit now runs on the raw points, which is unbiased at every density.
   */
  it('recovers the true rate at the density a real user actually has', () => {
    const everyWeek = (n: number, kgPerWeek: number): WeighPoint[] =>
      Array.from({ length: n }, (_, i) => ({
        date: new Date(Date.parse('2026-07-01T00:00:00Z') + i * 7 * 86_400_000).toISOString().slice(0, 10),
        kg: 90 + kgPerWeek * i,
      }));
    // Five weigh-ins is one month in. It has to be right THEN, not only after a quarter.
    expect(smoothedWeeklyRate(everyWeek(5, -0.5))).toBeCloseTo(-0.5, 2);
    expect(smoothedWeeklyRate(everyWeek(5, 0.25))).toBeCloseTo(0.25, 2);
    expect(smoothedWeeklyRate(everyWeek(13, -0.5))).toBeCloseTo(-0.5, 2);
  });

  it('refuses to name a rate off too little', () => {
    expect(smoothedWeeklyRate([])).toBeNull();
    expect(smoothedWeeklyRate([{ date: '2026-07-01', kg: 90 }])).toBeNull();
    expect(smoothedWeeklyRate(steady.slice(0, 2))).toBeNull(); // 2 points
    expect(
      smoothedWeeklyRate([
        { date: '2026-07-01', kg: 90 },
        { date: '2026-07-02', kg: 89.9 },
        { date: '2026-07-03', kg: 89.8 },
      ]),
    ).toBeNull(); // 3 points, under a week
  });

  it('ignores junk rather than letting it into the fit', () => {
    const withJunk = [...steady, { date: 'not-a-date', kg: 88 }, { date: '2026-07-30', kg: 0 }];
    expect(smoothedWeeklyRate(withJunk)).toBeCloseTo(smoothedWeeklyRate(steady)!, 3);
  });

  it('trendWeightKg lags the last reading toward the trend', () => {
    const spiked = [...steady, { date: '2026-08-05', kg: 90 }];
    const trend = trendWeightKg(spiked)!;
    expect(trend).toBeLessThan(90); // not this morning's number
    expect(trend).toBeGreaterThan(88); // but it did move
  });

  it('says how much it can be trusted, so the coach can say "still watching"', () => {
    expect(trendConfidence([])).toBe('none');
    expect(trendConfidence(steady.slice(0, 2))).toBe('none');
    // Three readings inside a fortnight is a hint, not a verdict.
    expect(
      trendConfidence([
        { date: '2026-07-01', kg: 90 },
        { date: '2026-07-05', kg: 89.8 },
        { date: '2026-07-09', kg: 89.6 },
      ]),
    ).toBe('low');
    expect(trendConfidence(steady)).toBe('medium');
    const long = [...steady, { date: '2026-08-15', kg: 87 }];
    expect(trendConfidence(long)).toBe('high'); // spans 45 days
  });
});
