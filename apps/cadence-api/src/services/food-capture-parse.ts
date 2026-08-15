/**
 * Pure helpers for Req 5 WS2 food-capture job output → unsaved Food candidate.
 * No DB / AI Admin imports — unit-testable without CADENCE_* secrets.
 */
import {
  scaleNutrients,
  type FoodBaseUnit,
  type FoodNutrients,
  type FoodServing,
  type FoodSource,
} from '@cadence/shared';

/** Unsaved food shape ready for POST /nutrition/foods (or further UI edits). */
export interface FoodCandidate {
  name: string;
  brand: string | null;
  source: FoodSource;
  base_unit: FoodBaseUnit;
  macros_per_base: FoodNutrients;
  servings: FoodServing[];
  default_serving: number;
  confidence: number | null;
  photo_ref: string | null;
}

export interface ParsedLabelCapture {
  candidate: FoodCandidate;
  label_readable: boolean;
}

export interface ParsedIdentifyCapture {
  name: string | null;
  brand: string | null;
  confidence: number;
  photo_ref: string | null;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function asFiniteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function asTrimmedString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

/**
 * Pull nutrient numbers out of a job's `macros_per_serving`.
 *
 * `allowMicros` no longer gates whether micros are ALLOWED — an estimate carries them now — only
 * how precisely they are kept. The old rule ("micros come from labels/databases, not estimates")
 * sounded rigorous and cost the user the thing they wanted: a model can say a cup of strawberries
 * is roughly 90mg of vitamin C, the number printed on the bag is an approximation too, and a
 * rough figure the coach can watch and adjust beats a blank column (owner, 2026-08-15). What
 * keeps it honest is provenance — `source: 'ai'` on the macros — not silence.
 */
export function sanitizeCaptureNutrients(raw: unknown, fromLabel: boolean): FoodNutrients | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const out: FoodNutrients = {};
  const macroKeys = ['kcal', 'protein_g', 'carbs_g', 'fat_g'] as const;
  for (const key of macroKeys) {
    const n = asFiniteNumber(o[key]);
    if (n !== null) out[key] = key === 'kcal' ? Math.round(n) : Math.round(n * 10) / 10;
  }
  // Micrograms need two decimals to survive at all: B12's whole daily reference is 2.4µg.
  for (const key of MICRO_CAPTURE_KEYS) {
    const n = asFiniteNumber(o[key]);
    if (n === null || n < 0) continue;
    out[key] = key.endsWith('_ug') ? Math.round(n * 100) / 100 : Math.round(n * 10) / 10;
  }
  void fromLabel;
  // Need at least one macro to be useful as a food candidate.
  if (out.kcal === undefined && out.protein_g === undefined && out.carbs_g === undefined && out.fat_g === undefined)
    return null;
  return out;
}

/** The micronutrients a capture may carry — mirrors what the jobs are asked for. */
const MICRO_CAPTURE_KEYS = [
  'fiber_g',
  'sodium_mg',
  'iron_mg',
  'zinc_mg',
  'vitamin_c_mg',
  'calcium_mg',
  'potassium_mg',
  'vitamin_b12_ug',
] as const satisfies ReadonlyArray<keyof FoodNutrients>;

/** Map job serving_unit words onto FoodBaseUnit (g/ml/item). */
export function normalizeBaseUnit(unit: string | null | undefined): FoodBaseUnit {
  const u = (unit ?? '').toLowerCase().trim();
  if (u === 'g' || u === 'gram' || u === 'grams') return 'g';
  if (u === 'ml' || u === 'milliliter' || u === 'milliliters' || u === 'millilitre' || u === 'millilitres') return 'ml';
  return 'item';
}

/**
 * Convert macros_per_serving → macros_per_base.
 * g/ml: per-100; item: per-1 item (serving_size is the item count in one serving).
 */
export function servingMacrosToPerBase(
  macros: FoodNutrients,
  servingSize: number,
  baseUnit: FoodBaseUnit,
): FoodNutrients {
  if (baseUnit === 'item') {
    const n = servingSize > 0 ? servingSize : 1;
    return scaleNutrients(macros, 1 / n);
  }
  if (!(servingSize > 0)) return macros;
  return scaleNutrients(macros, 100 / servingSize);
}

/** Build MFP-style servings[] from a capture serving; add a 100 g/ml option for mass/volume. */
export function buildCaptureServings(opts: {
  servingSize: number;
  servingUnit: string;
  servingLabel: string | null;
  baseUnit: FoodBaseUnit;
}): FoodServing[] {
  const amount = opts.servingSize > 0 ? opts.servingSize : 1;
  const unit = opts.servingUnit.trim() || opts.baseUnit;
  const label = opts.servingLabel?.trim() || (opts.baseUnit === 'item' ? `1 ${unit}` : `${amount} ${opts.baseUnit}`);
  const primary: FoodServing = { label, unit, amount_g: amount };
  if (opts.baseUnit === 'g' || opts.baseUnit === 'ml') {
    if (amount === 100 && unit === opts.baseUnit) return [primary];
    return [primary, { label: `100 ${opts.baseUnit}`, unit: opts.baseUnit, amount_g: 100 }];
  }
  return [primary];
}

function parseConfidence(raw: unknown, fallback: number): number {
  const n = asFiniteNumber(raw);
  return n === null ? fallback : clamp01(n);
}

/**
 * Shape parse-nutrition-label JSON into an unsaved Food candidate.
 * Throws on malformed JSON; returns label_readable:false when the panel was unreadable.
 */
export function parseLabelResult(
  raw: string,
  opts: { photoRef?: string | null; nameOverride?: string | null; brandOverride?: string | null } = {},
): ParsedLabelCapture {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const labelReadable = parsed.label_readable !== false;
  const confidence = parseConfidence(parsed.confidence, labelReadable ? 0.5 : 0.2);
  const servingSize = asFiniteNumber(parsed.serving_size) ?? 0;
  const servingUnit = asTrimmedString(parsed.serving_unit) ?? 'g';
  const servingLabel = asTrimmedString(parsed.serving_label);
  const baseUnit = normalizeBaseUnit(servingUnit);
  const perServing = sanitizeCaptureNutrients(parsed.macros_per_serving, true);
  const macrosPerBase = perServing
    ? servingMacrosToPerBase(perServing, servingSize > 0 ? servingSize : baseUnit === 'item' ? 1 : 100, baseUnit)
    : {};
  const servings = buildCaptureServings({
    servingSize: servingSize > 0 ? servingSize : baseUnit === 'item' ? 1 : 100,
    servingUnit,
    servingLabel,
    baseUnit,
  });
  const name =
    asTrimmedString(opts.nameOverride) ??
    asTrimmedString(parsed.name) ??
    (labelReadable ? 'Labeled food' : 'Unreadable label');
  const brand = opts.brandOverride !== undefined ? asTrimmedString(opts.brandOverride) : asTrimmedString(parsed.brand);

  return {
    label_readable: labelReadable && !!perServing,
    candidate: {
      name,
      brand,
      source: 'label_photo',
      base_unit: baseUnit,
      macros_per_base: macrosPerBase,
      servings,
      default_serving: 0,
      confidence,
      photo_ref: opts.photoRef ?? null,
    },
  };
}

/** Shape estimate-food JSON into an unsaved Food candidate (macros only — no micros). */
export function parseEstimateResult(raw: string): FoodCandidate {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const name = asTrimmedString(parsed.name);
  if (!name) throw new Error('estimate-food returned no name');
  const servingSize = asFiniteNumber(parsed.serving_size);
  if (servingSize === null || !(servingSize > 0)) throw new Error('estimate-food returned no serving_size');
  const servingUnit = asTrimmedString(parsed.serving_unit) ?? 'g';
  const servingLabel = asTrimmedString(parsed.serving_label);
  const perServing = sanitizeCaptureNutrients(parsed.macros_per_serving, false);
  if (!perServing) throw new Error('estimate-food returned no macros');
  const baseUnit = normalizeBaseUnit(servingUnit);
  return {
    name,
    brand: asTrimmedString(parsed.brand),
    source: 'llm',
    base_unit: baseUnit,
    macros_per_base: servingMacrosToPerBase(perServing, servingSize, baseUnit),
    servings: buildCaptureServings({ servingSize, servingUnit, servingLabel, baseUnit }),
    default_serving: 0,
    confidence: parseConfidence(parsed.confidence, 0.5),
    photo_ref: null,
  };
}

/** Shape identify-food JSON (name + brand only). */
export function parseIdentifyResult(raw: string, photoRef?: string | null): ParsedIdentifyCapture {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return {
    name: asTrimmedString(parsed.name),
    brand: asTrimmedString(parsed.brand),
    confidence: parseConfidence(parsed.confidence, 0.5),
    photo_ref: photoRef ?? null,
  };
}
