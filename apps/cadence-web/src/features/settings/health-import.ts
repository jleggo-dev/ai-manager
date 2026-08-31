import type { Workout } from '../../lib/capability/index.ts';

/** Pure helpers for the Apple Health import (kept out of the component file for fast refresh). */

/**
 * Set client-side after a successful HealthKit permission grant. There is no persisted
 * "connected" flag on the server to read — asking again would mean re-firing the permission
 * sheet just to check, which is exactly the silent-request behaviour this screen refuses to do
 * elsewhere. The Settings Room's summary row reads this instead of asking HealthKit.
 */
export const HEALTH_CONNECTED_KEY = 'cadence.healthConnected';

/**
 * "HKWorkoutActivityTypeTraditionalStrengthTraining" → "strength training".
 *
 * Never returns blank. HealthKit hands back an empty activity type for some workouts, and the
 * digest's own schema requires a non-empty name — so an unnamed workout used to reject the WHOLE
 * digest at the API boundary, which the user saw as "I couldn't read Apple Health just now".
 */
export function humanizeWorkoutType(rawType: string): string {
  const name = (rawType ?? '')
    .replace(/^HKWorkoutActivityType/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^traditional /i, '')
    .trim()
    .toLowerCase();
  return name || 'workout';
}

export function humanizeWorkout(w: Workout): string {
  const parts = [humanizeWorkoutType(w.type)];
  if (w.distanceKm) parts.push(`${w.distanceKm} km`);
  if (w.durationMin) parts.push(`${w.durationMin} min`);
  return parts.join(', ');
}

/** The adhoc log line — parsed by the same session-log path as a typed message. */
export function workoutLogText(w: Workout): string {
  return `${humanizeWorkout(w)} (from Apple Health)`;
}
