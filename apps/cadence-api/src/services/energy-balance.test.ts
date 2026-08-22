/**
 * A23 §3 — the calibration arithmetic. Pure: no DB, no AI, no clock.
 *
 * The headline is `bias cancels, variance does not`. It is the claim the whole project rests on —
 * that a ledger which under-prices everything still produces the right deficit — and it is the one
 * thing here that would be embarrassing to be wrong about, so it gets its own test.
 */
import { describe, it, expect } from 'vitest';
import {
  clampProposal,
  impliedMaintenance,
  targetForSafePace,
  COMPLETE_DAY_MIN_KCAL,
  KCAL_PER_KG,
  RATCHET_MAX_CUT_KCAL,
  type IntakeDay,
} from './energy-balance.ts';
import type { WeighPoint } from './weight-trend.ts';

const DAY = 86_400_000;
const START = Date.parse('2026-07-01T00:00:00Z');
const iso = (n: number): string => new Date(START + n * DAY).toISOString().slice(0, 10);

/** `n` consecutive complete days at `kcal`. */
function days(n: number, kcal: number, complete = true): IntakeDay[] {
  return Array.from({ length: n }, (_, i) => ({ date: iso(i), kcal, complete }));
}

/** Weigh-ins every 7 days losing `kgPerWeek` (negative = losing). */
function weights(count: number, startKg: number, kgPerWeek: number): WeighPoint[] {
  return Array.from({ length: count }, (_, i) => ({ date: iso(i * 7), kg: startKg + kgPerWeek * i }));
}

describe('impliedMaintenance', () => {
  it('puts maintenance ABOVE intake when they are losing', () => {
    // 2000 kcal/day while losing 0.5 kg/wk ⇒ 2000 + (7700 × 0.5)/7 = 2550.
    const { read } = impliedMaintenance(days(28, 2000), weights(5, 90, -0.5));
    expect(read).not.toBeNull();
    expect(read!.maintenance_kcal).toBeCloseTo(2550, -1);
    expect(read!.kg_per_week).toBeLessThan(0);
  });

  it('puts maintenance BELOW intake when they are gaining', () => {
    const { read } = impliedMaintenance(days(28, 3000), weights(5, 70, 0.25));
    expect(read!.maintenance_kcal).toBeLessThan(3000);
    // 3000 − (7700 × 0.25)/7 = 2725, reported to the nearest 10.
    expect(read!.maintenance_kcal).toBe(2730);
  });

  it('reads maintenance as intake when the weight is not moving', () => {
    const { read } = impliedMaintenance(days(28, 2200), weights(5, 80, 0));
    expect(read!.maintenance_kcal).toBeCloseTo(2200, -1);
  });

  /**
   * THE CLAIM. A ledger that under-prices every meal by 20% learns a maintenance that is under by
   * the same 20% — so the deficit it prescribes, in ledger units, still produces the intended
   * half-kilo a week. Bias cancels. This is why "consistency beats accuracy" is an engineering
   * fact here and not a slogan.
   */
  it('cancels a systematic pricing bias', () => {
    const honest = impliedMaintenance(days(28, 2000), weights(5, 90, -0.5)).read!;
    const under = impliedMaintenance(days(28, 1600), weights(5, 90, -0.5)).read!;

    // The two maintenances differ by exactly the mis-pricing…
    expect(honest.maintenance_kcal - under.maintenance_kcal).toBeCloseTo(400, -1);
    // …and the DEFICIT each implies is identical, which is the thing that moves the scale.
    const honestDeficit = honest.maintenance_kcal - honest.mean_intake_kcal;
    const underDeficit = under.maintenance_kcal - under.mean_intake_kcal;
    expect(underDeficit).toBeCloseTo(honestDeficit, 0);
  });

  it('refuses when too few days were properly logged', () => {
    const r = impliedMaintenance([...days(10, 2000), ...days(18, 2000, false)], weights(5, 90, -0.5));
    expect(r.read).toBeNull();
    expect(r.blocker).toBe('not_enough_logged_days');
    // And says how far along they are, so a panel can show progress rather than a closed door.
    expect(r.complete_days).toBe(10);
    expect(r.complete_days_needed).toBe(17);
  });

  it('does not count a day that is really a forgotten snack', () => {
    const thin = days(28, 2000).map((d, i) => (i < 20 ? d : { ...d, kcal: COMPLETE_DAY_MIN_KCAL - 100 }));
    const r = impliedMaintenance(thin, weights(5, 90, -0.5));
    expect(r.complete_days).toBe(20);
  });

  it('refuses on too few weigh-ins, or too short a span of them', () => {
    expect(impliedMaintenance(days(28, 2000), weights(2, 90, -0.5)).blocker).toBe('not_enough_weigh_ins');
    const crammed: WeighPoint[] = [
      { date: iso(0), kg: 90 },
      { date: iso(2), kg: 89.8 },
      { date: iso(4), kg: 89.6 },
    ];
    expect(impliedMaintenance(days(28, 2000), crammed).blocker).toBe('not_enough_weigh_ins');
  });

  it('refuses a window too short to mean anything', () => {
    expect(impliedMaintenance(days(14, 2000), weights(3, 90, -0.5), 14).blocker).toBe('window_too_short');
  });

  /** Inputs that disagree violently are a bug somewhere, not a prescription. */
  it('refuses an inhuman answer rather than prescribing from it', () => {
    // 4 kg/wk of 'loss' implies ~4,400 kcal/day above intake — a mis-logged week or a scale
    // in the wrong units, not a person.
    const r = impliedMaintenance(days(28, 2000), weights(5, 90, -4));
    expect(r.read).toBeNull();
  });

  it('is only as confident as its weaker half', () => {
    const dense = impliedMaintenance(days(28, 2000), weights(7, 90, -0.5)).read!;
    expect(dense.confidence).toBe('high');
    // Same weigh-ins, patchier logging → the estimate is capped by the food side.
    const patchy = impliedMaintenance([...days(18, 2000), ...days(10, 2000, false)], weights(7, 90, -0.5)).read!;
    expect(patchy.confidence).toBe('low');
  });
});

describe('targetForSafePace', () => {
  it('subtracts the safe deficit for a loss goal', () => {
    // 90 kg → safe 0.68 kg/wk → ~748 kcal/day under maintenance.
    const t = targetForSafePace(2550, 90, 'lose');
    expect(t).toBeLessThan(2550);
    expect(2550 - t).toBeCloseTo((KCAL_PER_KG * 0.68) / 7, -2);
  });

  it('adds it for a gain goal, and holds at maintenance otherwise', () => {
    expect(targetForSafePace(2550, 90, 'gain')).toBeGreaterThan(2550);
    expect(targetForSafePace(2550, 90, 'hold')).toBe(2550);
  });
});

describe('clampProposal — the guardrails, in code rather than prompt prose', () => {
  const base = { current_kcal: 2200, maintenance_kcal: 2550, adjustments: [], today: iso(30) };

  it('leaves a sane proposal alone', () => {
    expect(clampProposal(2300, base)).toEqual({ kcal: 2300, limited_by: null });
  });

  it('will not go more than 15% below maintenance, however the maths argues', () => {
    const r = clampProposal(1500, base);
    expect(r.kcal).toBe(2170); // 0.85 × 2550
    expect(r.limited_by).toBe('maintenance_floor');
  });

  /**
   * The failure mode calibration invites: a plateau looks exactly like "the deficit is too small",
   * so a loop that only subtracts keeps subtracting. The cap turns the next cut into a
   * conversation instead of a smaller number.
   */
  it('caps cumulative cuts inside the rolling window', () => {
    const withCuts = {
      ...base,
      maintenance_kcal: null,
      adjustments: [
        { date: iso(10), from: 2500, to: 2350 },
        { date: iso(20), from: 2350, to: 2200 },
      ],
    };
    // 300 already cut, so no further cut is available at all.
    const r = clampProposal(1900, withCuts);
    expect(r.kcal).toBe(2200);
    expect(r.limited_by).toBe('ratchet');
  });

  it('lets the window expire so the loop is capped, not frozen', () => {
    const old = {
      ...base,
      maintenance_kcal: null,
      adjustments: [{ date: iso(-40), from: 2500, to: 2200 }],
    };
    expect(clampProposal(2050, old).kcal).toBe(2050);
  });

  it('counts only cuts, never a raise, toward the cap', () => {
    const raised = {
      ...base,
      maintenance_kcal: null,
      adjustments: [{ date: iso(20), from: 2000, to: 2400 }],
    };
    const r = clampProposal(2200 - RATCHET_MAX_CUT_KCAL, raised);
    expect(r.limited_by).toBeNull();
  });

  it('never blocks a RAISE — the too-fast case must always be able to act', () => {
    const maxedOut = {
      ...base,
      adjustments: [{ date: iso(20), from: 2500, to: 2200 }],
    };
    expect(clampProposal(2450, maxedOut)).toEqual({ kcal: 2450, limited_by: null });
  });
});
