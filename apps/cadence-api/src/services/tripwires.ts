import type { Tripwire } from '@cadence/shared';

/**
 * Session-start tripwires (spec §B4) — pure deterministic app code, NO LLM.
 * If this returns [], NO Broker `situation_assess` call is made. If anything
 * fires, the Broker evaluates and *proposes* an action (disrupted mode / check-in
 * / replan) — never auto-applied.
 */
export interface TripwireSnapshot {
  homeTimezoneOffsetMin?: number;
  currentTimezoneOffsetMin?: number;
  homeLat?: number;
  homeLon?: number;
  currentLat?: number;
  currentLon?: number;
  missedCount?: number;
  missedThreshold?: number;
  consistencyRate?: number; // 0..1 over the window
  outcomeDelta?: number; // signed progress toward the target metric
  consistencyDropped?: boolean; // a rolling-window dip (never "you lost your streak")
  weatherTempC?: number;
}

export const TRIPWIRE_THRESHOLDS = {
  timezoneShiftMin: 120, // ≥ 2h
  locationMoveKm: 100,
  highConsistency: 0.8, // consistency/outcome divergence = showing up but the outcome isn't moving
  extremeColdC: -10,
  extremeHotC: 38,
};

export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function detectTripwires(s: TripwireSnapshot): Tripwire[] {
  const fired: Tripwire[] = [];
  const t = TRIPWIRE_THRESHOLDS;

  if (
    s.homeTimezoneOffsetMin != null &&
    s.currentTimezoneOffsetMin != null &&
    Math.abs(s.currentTimezoneOffsetMin - s.homeTimezoneOffsetMin) >= t.timezoneShiftMin
  ) {
    fired.push('timezone_shift');
  }

  if (
    s.homeLat != null &&
    s.homeLon != null &&
    s.currentLat != null &&
    s.currentLon != null &&
    haversineKm(s.homeLat, s.homeLon, s.currentLat, s.currentLon) >= t.locationMoveKm
  ) {
    fired.push('location_move');
  }

  if (s.missedCount != null && s.missedThreshold != null && s.missedCount >= s.missedThreshold) {
    fired.push('missed_threshold');
  }

  if (
    s.consistencyRate != null &&
    s.outcomeDelta != null &&
    s.consistencyRate >= t.highConsistency &&
    s.outcomeDelta <= 0
  ) {
    fired.push('consistency_outcome_divergence');
  }

  if (s.consistencyDropped) fired.push('consistency_drop');

  if (s.weatherTempC != null && (s.weatherTempC <= t.extremeColdC || s.weatherTempC >= t.extremeHotC)) {
    fired.push('extreme_weather');
  }

  return fired;
}
