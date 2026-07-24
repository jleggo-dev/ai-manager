/**
 * Deterministic exercise-burn estimate — a "tool library" entry (plan §net-calorie eat-back). MFP-style:
 * kcal ≈ MET × bodyweight(kg) × hours. Pure, no DB/AI, so it's unit-testable and the daily net-calorie
 * math is predictable. Non-physical activities (reflection, food log, weigh-in) burn nothing.
 */

/** MET by activity `category` (Activity.category / the coach's session category). Conservative,
 *  round values from the Compendium of Physical Activities — an estimate, never a precise claim. */
const MET_BY_CATEGORY: Record<string, number> = {
  run: 9.8,
  running: 9.8,
  cardio: 7.0,
  strength: 5.0,
  mobility: 2.8,
  recovery: 2.5,
  movement: 6.0, // generic physical
};
const DEFAULT_PHYSICAL_MET = 4.0; // unknown but physical category — a modest default

/** Categories that do no physical work — always 0 burn. */
const NON_PHYSICAL = new Set(['reflection', 'system', 'nourishment', 'measurement', 'health', 'mind', 'practice']);

/**
 * Estimated kcal burned for one session. Returns 0 for non-physical categories, a missing/zero
 * duration, or an implausible bodyweight. Rounded to the nearest 10 (an estimate, honest round numbers).
 */
export function estimateBurnKcal(
  category: string | null | undefined,
  durationMin?: number | null,
  weightKg?: number | null,
): number {
  if (!durationMin || durationMin <= 0 || !weightKg || weightKg < 20 || weightKg > 500) return 0;
  const cat = (category ?? '').trim().toLowerCase();
  if (!cat || NON_PHYSICAL.has(cat)) return 0;
  const met = MET_BY_CATEGORY[cat] ?? DEFAULT_PHYSICAL_MET;
  return Math.round((met * weightKg * (durationMin / 60)) / 10) * 10;
}
