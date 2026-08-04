import { describe, expect, it } from 'vitest';
import { TRIPWIRE_THRESHOLDS as T, detectTripwires, haversineKm } from './tripwires.ts';

/**
 * The tripwires are the gate on the whole adaptation path: an empty result means NO
 * `situation-assess` call is made at all. That makes this the cheapest place in the system to get
 * something expensive wrong in either direction — a wire that never fires makes the coach blind to
 * a disrupted week, and one that fires on nothing spends a model call every time someone opens
 * their plan, then interrupts them with a proposal about a life event that didn't happen.
 *
 * It shipped untested. These cover the boundaries, the empty case, and the guard that matters
 * most: partial data must never fire a wire.
 */
describe('the gate: nothing fires without evidence', () => {
  it('an empty snapshot calls no LLM', () => {
    expect(detectTripwires({})).toEqual([]);
  });

  // Every wire needs BOTH halves of its comparison. Half a fact is not evidence, and a wire that
  // fired on a missing home location would propose a detour to someone sitting at home.
  it('half a fact never fires a wire', () => {
    expect(detectTripwires({ currentTimezoneOffsetMin: 600 })).toEqual([]);
    expect(detectTripwires({ homeTimezoneOffsetMin: 0 })).toEqual([]);
    expect(detectTripwires({ homeLat: 51.5, homeLon: -0.1, currentLat: 40.7 })).toEqual([]);
    expect(detectTripwires({ missedCount: 99 })).toEqual([]);
    expect(detectTripwires({ missedThreshold: 1 })).toEqual([]);
    expect(detectTripwires({ consistencyRate: 1 })).toEqual([]);
    expect(detectTripwires({ outcomeDelta: -5 })).toEqual([]);
  });

  it('a zero is a value, not a missing fact', () => {
    // outcomeDelta 0 means "measured, and it did not move" — the divergence case exactly.
    expect(detectTripwires({ consistencyRate: 0.9, outcomeDelta: 0 })).toContain('consistency_outcome_divergence');
    // A home timezone of UTC+0 must still be comparable.
    expect(detectTripwires({ homeTimezoneOffsetMin: 0, currentTimezoneOffsetMin: 120 })).toContain('timezone_shift');
  });
});

describe('each wire, at its boundary', () => {
  it('timezone shift fires AT the threshold, in both directions', () => {
    const at = T.timezoneShiftMin;
    expect(detectTripwires({ homeTimezoneOffsetMin: 0, currentTimezoneOffsetMin: at })).toContain('timezone_shift');
    expect(detectTripwires({ homeTimezoneOffsetMin: 0, currentTimezoneOffsetMin: -at })).toContain('timezone_shift');
    expect(detectTripwires({ homeTimezoneOffsetMin: 0, currentTimezoneOffsetMin: at - 1 })).toEqual([]);
  });

  it('location move fires past 100km and ignores a normal commute', () => {
    // London → Paris ≈ 340km.
    expect(detectTripwires({ homeLat: 51.5, homeLon: -0.13, currentLat: 48.86, currentLon: 2.35 })).toContain(
      'location_move',
    );
    // Across a large city — someone at the far gym, not someone travelling.
    expect(detectTripwires({ homeLat: 51.5, homeLon: -0.13, currentLat: 51.6, currentLon: -0.3 })).toEqual([]);
  });

  it('missed sessions fire at the threshold, not above it', () => {
    expect(detectTripwires({ missedCount: 3, missedThreshold: 3 })).toContain('missed_threshold');
    expect(detectTripwires({ missedCount: 2, missedThreshold: 3 })).toEqual([]);
  });

  // "Showing up and the number isn't moving" — the one wire about the PLAN failing rather than the
  // person. It must not fire on someone who is simply not showing up; that is missed_threshold.
  it('divergence needs high consistency AND a stalled outcome', () => {
    expect(detectTripwires({ consistencyRate: T.highConsistency, outcomeDelta: -1 })).toContain(
      'consistency_outcome_divergence',
    );
    expect(detectTripwires({ consistencyRate: 0.5, outcomeDelta: -1 })).toEqual([]);
    expect(detectTripwires({ consistencyRate: 0.95, outcomeDelta: 2 })).toEqual([]);
  });

  it('a consistency dip fires only when the caller says so', () => {
    expect(detectTripwires({ consistencyDropped: true })).toEqual(['consistency_drop']);
    expect(detectTripwires({ consistencyDropped: false })).toEqual([]);
  });

  it('extreme weather fires at both ends and stays quiet in between', () => {
    expect(detectTripwires({ weatherTempC: T.extremeColdC })).toContain('extreme_weather');
    expect(detectTripwires({ weatherTempC: T.extremeHotC })).toContain('extreme_weather');
    expect(detectTripwires({ weatherTempC: 18 })).toEqual([]);
  });
});

describe('several at once', () => {
  it('reports every wire that fired, not just the first', () => {
    const fired = detectTripwires({
      homeTimezoneOffsetMin: 0,
      currentTimezoneOffsetMin: 480,
      homeLat: 51.5,
      homeLon: -0.13,
      currentLat: 35.7,
      currentLon: 139.7,
      weatherTempC: 39,
    });
    // A trip abroad in a heatwave is one situation; the assessor needs all three to say so.
    expect(fired).toEqual(expect.arrayContaining(['timezone_shift', 'location_move', 'extreme_weather']));
  });
});

describe('haversineKm', () => {
  it('measures real distance and is symmetric', () => {
    const km = haversineKm(51.5, -0.13, 48.86, 2.35);
    expect(km).toBeGreaterThan(330);
    expect(km).toBeLessThan(350);
    expect(haversineKm(48.86, 2.35, 51.5, -0.13)).toBeCloseTo(km, 6);
  });

  it('is zero at the same point', () => {
    expect(haversineKm(51.5, -0.13, 51.5, -0.13)).toBe(0);
  });
});
