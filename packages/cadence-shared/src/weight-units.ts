/**
 * Weight in the unit the user actually thinks in.
 *
 * Storage is canonical kg — always, everywhere. `baseline.weight_unit` records what they SAID, and
 * display converts back. That split is right and the app already honours it in `progress.ts` and
 * `weigh-in.ts`.
 *
 * The coach did not. `get_weight`'s render hardcoded `kg`, so a user who gave their weight in
 * pounds was told it back in kilos and then coached in metric throughout (owner, 2026-08-22). The
 * conversion existed twice already, in those two files, and neither was reachable from the
 * retrieval registry — so the third copy would have been the one that drifted. It lives here now
 * and all three use it.
 *
 * `lb` and `lbs` are both accepted because both are in the data: `weigh-in.ts` writes `lbs`, older
 * rows carry `lb`. Reading has to tolerate what was actually written.
 */
export const LB_PER_KG = 2.2046226218;

export type WeightUnit = 'kg' | 'lb';

/** What unit to SHOW, from whatever `baseline.weight_unit` happens to hold. Defaults to kg. */
export function displayWeightUnit(stored: unknown): WeightUnit {
  const u = String(stored ?? '')
    .trim()
    .toLowerCase();
  return u === 'lbs' || u === 'lb' ? 'lb' : 'kg';
}

/**
 * A stored kg figure as the user reads it. Rounded to one decimal: a bodyweight is measured to
 * about that, and 195.10382lb is a false precision that invites arguing with the scale.
 */
export function formatWeight(kg: number, unit: WeightUnit): string {
  const n = unit === 'lb' ? kg * LB_PER_KG : kg;
  return `${Math.round(n * 10) / 10}${unit}`;
}

/**
 * A weekly rate of change, in their unit.
 *
 * Two decimals rather than `formatWeight`'s one, because a rate is compared against a THRESHOLD:
 * a safe loss of 0.45 kg/wk rounded to 0.5 is a different verdict from the one the numbers support,
 * and this string is the evidence `set_macro_targets` adjusts on. The sign is kept — a gain and a
 * loss are not the same news.
 */
export function formatWeightRate(kgPerWeek: number, unit: WeightUnit): string {
  const n = unit === 'lb' ? kgPerWeek * LB_PER_KG : kgPerWeek;
  return `${Math.round(n * 100) / 100} ${unit}/wk`;
}
