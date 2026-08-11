import { describe, expect, it } from 'vitest';
import { isRecordedDistance, recordedDistanceKm } from './workout-distance.ts';

/**
 * The bug this exists for: the vendored Swift plugin returns `totalDistance ?? 0`, so "HealthKit
 * recorded no distance" and "they covered zero kilometres" arrive as the same number. Averaged
 * together, a treadmill run pulls a runner's mean distance down — which is half of why someone
 * running 5–6 km five times a week was told he averages 4.3 km.
 */
describe('recordedDistanceKm', () => {
  it('reads exactly 0 as "not recorded", never as zero kilometres', () => {
    expect(recordedDistanceKm(0)).toBeUndefined();
    expect(isRecordedDistance(0)).toBe(false);
  });

  it('keeps every real distance, rounded to the seam’s 10 m resolution', () => {
    expect(recordedDistanceKm(5432)).toBe(5.43);
    expect(isRecordedDistance(5.43)).toBe(true);
  });

  it('never hands back a rounded-to-zero distance, which would be the sentinel again', () => {
    // Whatever survives this function must be usable as a distance; 4 m is not.
    expect(recordedDistanceKm(4)).toBeUndefined();
    expect(recordedDistanceKm(10)).toBe(0.01);
  });

  it('treats missing and nonsense the same as not recorded', () => {
    // A NaN or a null must never become a 0 that gets averaged in.
    expect(recordedDistanceKm(undefined)).toBeUndefined();
    expect(recordedDistanceKm(null)).toBeUndefined();
    expect(recordedDistanceKm(Number.NaN)).toBeUndefined();
    expect(recordedDistanceKm(-100)).toBeUndefined();
  });
});
