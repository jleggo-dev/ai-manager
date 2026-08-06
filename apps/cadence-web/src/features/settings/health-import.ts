import type { Workout } from '../../lib/capability/index.ts';

/** Pure helpers for the Apple Health import (kept out of the component file for fast refresh). */

/** "HKWorkoutActivityTypeTraditionalStrengthTraining" → "strength training". */
export function humanizeWorkout(w: Workout): string {
  const type = w.type
    .replace(/^HKWorkoutActivityType/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^traditional /i, '')
    .toLowerCase();
  const parts = [type];
  if (w.distanceKm) parts.push(`${w.distanceKm} km`);
  if (w.durationMin) parts.push(`${w.durationMin} min`);
  return parts.join(', ');
}

/** The adhoc log line — parsed by the same session-log path as a typed message. */
export function workoutLogText(w: Workout): string {
  return `${humanizeWorkout(w)} (from Apple Health)`;
}
