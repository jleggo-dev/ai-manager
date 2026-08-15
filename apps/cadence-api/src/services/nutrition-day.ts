import type { Macros, NutritionLog } from '@cadence/shared';

/**
 * Daily nutrition rollup — pure and deterministic (no DB/engine imports; unit-tested like
 * capture-normalize.ts). The S1 rules live here: PROVISIONAL rows (low-confidence estimates the
 * user hasn't confirmed) are summed separately and never enter the day's totals; "left" is
 * clamped at ≥0 — we count what's left, never what broke.
 */

/**
 * Everything a day can sum. The four macros, then the micronutrients that decide whether a diet
 * is nourishing rather than merely arithmetic — they used to be computed per food and thrown away
 * at this boundary, so a day could never show iron and a target could never contain B12.
 */
export const MACRO_KEYS = [
  'kcal',
  'protein_g',
  'carbs_g',
  'fat_g',
  'fiber_g',
  'sodium_mg',
  'iron_mg',
  'zinc_mg',
  'vitamin_c_mg',
  'calcium_mg',
  'potassium_mg',
  'vitamin_b12_ug',
] as const;
export type MacroKey = (typeof MACRO_KEYS)[number];

/**
 * Per-MEAL sanity caps. Generous on purpose — these exist to stop one mis-parsed row poisoning a
 * day's totals, not to police what someone ate. Micro caps sit well above any real meal (a
 * fortified cereal can carry several times the daily reference) while still rejecting the
 * unit-confusion outlier that would otherwise render as a bar off the end of the screen.
 */
const CAPS: Record<MacroKey, number> = {
  kcal: 6000,
  protein_g: 600,
  carbs_g: 600,
  fat_g: 600,
  fiber_g: 200,
  sodium_mg: 20_000,
  iron_mg: 200,
  zinc_mg: 200,
  vitamin_c_mg: 5_000,
  calcium_mg: 5_000,
  potassium_mg: 20_000,
  vitamin_b12_ug: 500,
};

/**
 * Clamp a model-emitted macros object into sane, rounded numbers (kcal nearest 10, grams nearest
 * 1; each capped per CAPS; negatives dropped). Returns null when nothing valid remains — an
 * omitted estimate stays omitted, never a row of zeros.
 */
export function sanitizeMacros(raw: unknown): Macros | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const out: Macros = {};
  for (const k of MACRO_KEYS) {
    const v = r[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
    // kcal to the nearest 10, grams whole, micros to 2dp — B12's whole reference intake is 2.4µg,
    // so rounding it like a gram would erase the nutrient this exists to track.
    const rounded =
      k === 'kcal' ? Math.round(v / 10) * 10 : k.endsWith('_g') ? Math.round(v) : Math.round(v * 100) / 100;
    if (rounded <= 0) continue;
    out[k] = Math.min(rounded, CAPS[k]);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Sanity windows for DAILY TARGETS (vs per-meal caps above): a proposal outside these is dropped
 * field-by-field — an absurd number is worse silently clamped than honestly absent.
 *
 * MACROS ONLY, deliberately. Micronutrient targets are not proposed by anyone — they are a lookup
 * from published reference intakes (`micronutrientTargets` in @cadence/shared), because "you need
 * 18mg of iron" is a fact about human biology rather than a judgement about this person. A model
 * emitting a micro target here is a model exceeding its brief, and it gets dropped.
 */
const TARGET_RANGES: Partial<Record<MacroKey, [number, number]>> = {
  kcal: [1000, 4500],
  protein_g: [30, 300],
  carbs_g: [20, 600],
  fat_g: [15, 250],
};

/** Round + range-check proposed daily targets (kcal→50s, grams→5s); null when nothing survives. */
export function sanitizeTargets(raw: unknown): Macros | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const out: Macros = {};
  for (const k of MACRO_KEYS) {
    const range = TARGET_RANGES[k];
    // No range = not a proposable target (every micronutrient). Silently ignored rather than
    // stored: those come from the reference table, never from a proposal.
    if (!range) continue;
    const v = r[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const rounded = k === 'kcal' ? Math.round(v / 50) * 50 : Math.round(v / 5) * 5;
    if (rounded < range[0] || rounded > range[1]) continue;
    out[k] = rounded;
  }
  return Object.keys(out).length ? out : null;
}

export interface DayTotals {
  totals: Macros; // confirmed rows only — what the rings/targets count
  provisional_totals: Macros; // low-confidence estimates awaiting a tap-to-confirm
  confirmed_count: number; // meals contributing to totals (macros present, not provisional)
  provisional_count: number; // meals awaiting confirmation
}

/** Sum a day's meals into confirmed vs provisional buckets. Meals without macros list-only. */
export function sumDay(rows: Array<Pick<NutritionLog, 'macros' | 'provisional'>>): DayTotals {
  const totals: Macros = {};
  const provisional: Macros = {};
  let confirmedCount = 0;
  let provisionalCount = 0;
  for (const row of rows) {
    const m = row.macros ?? {};
    const has = MACRO_KEYS.some((k) => typeof m[k] === 'number' && (m[k] as number) > 0);
    if (!has) continue;
    const bucket = row.provisional ? provisional : totals;
    if (row.provisional) provisionalCount++;
    else confirmedCount++;
    for (const k of MACRO_KEYS) {
      const v = m[k];
      if (typeof v === 'number' && v > 0) bucket[k] = (bucket[k] ?? 0) + v;
    }
  }
  return {
    totals,
    provisional_totals: provisional,
    confirmed_count: confirmedCount,
    provisional_count: provisionalCount,
  };
}

/**
 * What's LEFT toward each target the user has actually set (absent targets produce no entry;
 * clamped at 0 — hitting a target reads "0 left", never a negative).
 */
export function computeLeft(
  targets: Partial<Record<MacroKey, number | null | undefined>> | null | undefined,
  totals: Macros,
): Macros | null {
  if (!targets) return null;
  const left: Macros = {};
  for (const k of MACRO_KEYS) {
    const t = targets[k];
    if (typeof t !== 'number' || t <= 0) continue;
    left[k] = Math.max(0, Math.round((t - (totals[k] ?? 0)) * 10) / 10);
  }
  return Object.keys(left).length ? left : null;
}
