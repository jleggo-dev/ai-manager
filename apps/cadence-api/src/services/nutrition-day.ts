import type { Macros, NutritionLog } from '@cadence/shared';

/**
 * Daily nutrition rollup — pure and deterministic (no DB/engine imports; unit-tested like
 * capture-normalize.ts). The S1 rules live here: PROVISIONAL rows (low-confidence estimates the
 * user hasn't confirmed) are summed separately and never enter the day's totals; "left" is
 * clamped at ≥0 — we count what's left, never what broke.
 */

export const MACRO_KEYS = ['kcal', 'protein_g', 'carbs_g', 'fat_g'] as const;
export type MacroKey = (typeof MACRO_KEYS)[number];

const CAPS: Record<MacroKey, number> = { kcal: 6000, protein_g: 600, carbs_g: 600, fat_g: 600 };

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
    const rounded = k === 'kcal' ? Math.round(v / 10) * 10 : Math.round(v);
    if (rounded <= 0) continue;
    out[k] = Math.min(rounded, CAPS[k]);
  }
  return Object.keys(out).length ? out : null;
}

/** Sanity windows for DAILY TARGETS (vs per-meal caps above): a proposal outside these is
 *  dropped field-by-field — an absurd number is worse silently clamped than honestly absent. */
const TARGET_RANGES: Record<MacroKey, [number, number]> = {
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
    const v = r[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const rounded = k === 'kcal' ? Math.round(v / 50) * 50 : Math.round(v / 5) * 5;
    const [lo, hi] = TARGET_RANGES[k];
    if (rounded < lo || rounded > hi) continue;
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
  return { totals, provisional_totals: provisional, confirmed_count: confirmedCount, provisional_count: provisionalCount };
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
