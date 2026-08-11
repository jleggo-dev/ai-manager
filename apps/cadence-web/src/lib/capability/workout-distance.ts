/**
 * "No distance was recorded" vs "they covered zero kilometres" — a JS stopgap, not the fix.
 *
 * capacitor-health's HealthPlugin.swift returns
 *   "distance": workout.totalDistance?.doubleValue(for: .meter()) ?? 0
 * so a workout HealthKit holds NO distance for reaches us as a hard 0, indistinguishable from a
 * real one. `toSeamWorkout`'s `typeof w.distance === 'number'` is therefore always true and the
 * digest's `.filter((n) => n != null)` never drops a thing, so a treadmill run — or any session
 * mistyped as a run — is averaged in as a 0 km run and drags the mean down. That is one half of
 * why someone who had run 5–6 km five times in a week was told he averages 4.3 km.
 *
 * **The clean fix belongs in the native bridge** — emit `null` when `totalDistance` is nil, which
 * is what A14 proposes. The plugin is vendored in `node_modules` with no patch-package in this
 * repo, so there is nowhere to land that change today. Until it exists we infer absence here.
 *
 * The inference: exactly 0 means "not recorded". No real session of any type covers 0.000 m, so
 * nothing true is lost — a distance-bearing type gets its mean back, and a type that never carries
 * distance at all (strength work) stops reporting a meaningless "avg 0.0 km".
 *
 * What this must NOT do is drop the session. An indoor row still happened, still took 40 minutes
 * and still counts as a session — it simply has no distance. Only the distance goes missing.
 */

/** True when a distance figure is real evidence rather than the plugin's `?? 0` standing in. */
export function isRecordedDistance(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Plugin metres → seam kilometres, or `undefined` when nothing was recorded.
 * Applied at the seam so every consumer of `getWorkouts` inherits the distinction, not just the
 * digest — the settings list and the ad-hoc log read the same rows.
 */
export function recordedDistanceKm(meters: number | null | undefined): number | undefined {
  if (!isRecordedDistance(meters)) return undefined;
  const km = Math.round((meters / 1000) * 100) / 100;
  // A handful of metres rounds to 0.00 km, which is the very sentinel we are trying to abolish.
  // Anything that small carries no usable distance, so say "not recorded" and keep the invariant:
  // a distance that survives this function is always greater than zero.
  return km > 0 ? km : undefined;
}
