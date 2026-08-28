/**
 * Reading a household measure, and knowing when an answer about one is physically impossible.
 *
 * The gap this serves is the owner's shallots case: *"USDA has shallots, but only by oz. Cadence
 * should be able to look up how much 1/4 c of shallots typically weighs and do that math."*
 *
 * `ABSOLUTE_UNITS` in `food-pricing-portion.ts` deliberately refuses cups, and that refusal is
 * correct — *"a food that has a cup serving should use its own cup, and one that doesn't should not
 * have a volume invented for it."* Grams per cup is a property of the FOOD, not of the unit: a cup
 * of shallots and a cup of honey share a volume and nothing else. So this module does not convert
 * volume to mass. It only says what was asked for, precisely enough that something else can go and
 * find out, and then checks the answer against physics.
 *
 * Nothing here talks to a model or a database; it is arithmetic and vocabulary, so it tests without
 * either.
 */

import type { FoodServing } from '@cadence/shared';

export type MeasureKind = 'mass' | 'volume' | 'count';

export interface ParsedMeasure {
  kind: MeasureKind;
  /** How many of `unit`. "1/4 cup" → 0.25; "3 shallots" → 3. */
  qty: number;
  /** Canonical unit key: 'g' | 'ml' | 'cup' | 'tbsp' | 'tsp' | 'item' | … */
  unit: string;
  /** Total millilitres, when the measure names a volume. Null otherwise. */
  ml: number | null;
  /** Total grams, when the measure already names a mass — nothing to look up. Null otherwise. */
  grams: number | null;
  /** Tidied form, used as the `servings[]` label when an answer gets written back. */
  label: string;
  /** For a count, the thing being counted ("shallots"); empty for mass/volume. */
  countOf: string;
}

/** US customary, which is what a recipe written in English means by these words. */
const VOLUME_ML: Record<string, number> = {
  ml: 1,
  milliliter: 1,
  millilitre: 1,
  cc: 1,
  l: 1000,
  liter: 1000,
  litre: 1000,
  tsp: 4.92892,
  teaspoon: 4.92892,
  tbsp: 14.7868,
  tbs: 14.7868,
  tablespoon: 14.7868,
  floz: 29.5735,
  cup: 236.588,
  pint: 473.176,
  pt: 473.176,
  quart: 946.353,
  qt: 946.353,
  gallon: 3785.41,
};

const MASS_G: Record<string, number> = {
  g: 1,
  gram: 1,
  gramme: 1,
  kg: 1000,
  kilogram: 1000,
  mg: 0.001,
  oz: 28.3495,
  ounce: 28.3495,
  lb: 453.592,
  pound: 453.592,
};

/** Singularise crudely — "cups" → "cup". Enough for a unit table, not for English. */
export function singular(word: string): string {
  const w = word.toLowerCase().replace(/\./g, '');
  if (w === 'oz' || w === 'floz') return w;
  return w.endsWith('es') && w.length > 4 ? w.slice(0, -2) : w.endsWith('s') && w.length > 2 ? w.slice(0, -1) : w;
}

const UNICODE_FRACTIONS: Record<string, number> = {
  '¼': 0.25,
  '½': 0.5,
  '¾': 0.75,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅛': 0.125,
};

/**
 * Leading quantity: "1/4", "1 1/2", "0.5", "½", "1½", or nothing (which means one).
 * Returns the number and the rest of the string.
 */
export function parseLeadingQuantity(text: string): { qty: number; rest: string } {
  let s = text.trim();
  let qty: number | null = null;

  // A whole number followed by a fraction — "1 1/2 cups", "1½ cups".
  const mixed = s.match(/^(\d+)\s*(\d+)\s*\/\s*(\d+)\b/);
  const mixedUni = s.match(/^(\d+)\s*([¼½¾⅓⅔⅛])/);
  const fraction = s.match(/^(\d+)\s*\/\s*(\d+)/);
  const uni = s.match(/^([¼½¾⅓⅔⅛])/);
  const decimal = s.match(/^(\d+(?:\.\d+)?)/);

  if (mixed) {
    const den = Number(mixed[3]);
    qty = den ? Number(mixed[1]) + Number(mixed[2]) / den : Number(mixed[1]);
    s = s.slice(mixed[0].length);
  } else if (mixedUni) {
    qty = Number(mixedUni[1]) + (UNICODE_FRACTIONS[mixedUni[2] as string] ?? 0);
    s = s.slice(mixedUni[0].length);
  } else if (fraction) {
    const den = Number(fraction[2]);
    qty = den ? Number(fraction[1]) / den : null;
    s = s.slice(fraction[0].length);
  } else if (uni) {
    qty = UNICODE_FRACTIONS[uni[1] as string] ?? null;
    s = s.slice(uni[0].length);
  } else if (decimal) {
    qty = Number(decimal[1]);
    s = s.slice(decimal[0].length);
  }

  const word = s.trim().match(/^(a|an|one|two|three|four|five|six|half)\b/i);
  if (qty === null && word) {
    const map: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5 };
    qty = map[word[1]!.toLowerCase()] ?? 1;
    s = s.slice(word[0].length);
  }

  return { qty: qty !== null && Number.isFinite(qty) && qty > 0 ? qty : 1, rest: s.trim() };
}

/**
 * Read a measure phrase. Never throws and never returns null: an unrecognised unit is a COUNT of
 * whatever was named, which is the honest reading of "3 shallots" and also of "2 handfuls".
 */
export function parseMeasure(text: string): ParsedMeasure {
  const raw = (text ?? '').trim();
  const { qty, rest } = parseLeadingQuantity(raw);

  // The unit is the first word after the quantity; the remainder describes the food.
  const firstWord = rest.match(/^([a-zÀ-ɏ.]+)/i)?.[1] ?? '';
  const key = singular(firstWord);
  const trailing = rest
    .slice(firstWord.length)
    .trim()
    .replace(/^of\s+/i, '');

  if (key in MASS_G) {
    const grams = qty * (MASS_G[key] as number);
    return { kind: 'mass', qty, unit: key, ml: null, grams, label: `${trim(qty)} ${firstWord}`.trim(), countOf: '' };
  }

  if (key in VOLUME_ML) {
    const ml = qty * (VOLUME_ML[key] as number);
    return { kind: 'volume', qty, unit: key, ml, grams: null, label: `${trim(qty)} ${firstWord}`.trim(), countOf: '' };
  }

  const countOf = (firstWord ? `${firstWord} ${trailing}` : trailing).trim();
  return {
    kind: 'count',
    qty,
    unit: 'item',
    ml: null,
    grams: null,
    label: countOf ? `${trim(qty)} ${countOf}` : `${trim(qty)} item${qty === 1 ? '' : 's'}`,
    countOf,
  };
}

/** Numbers a person would write: 0.25 → "1/4", 1 → "1", 1.5 → "1 1/2". */
function trim(n: number): string {
  const common: Array<[number, string]> = [
    [0.125, '1/8'],
    [0.25, '1/4'],
    [1 / 3, '1/3'],
    [0.5, '1/2'],
    [2 / 3, '2/3'],
    [0.75, '3/4'],
  ];
  const whole = Math.floor(n);
  const frac = n - whole;
  const hit = common.find(([v]) => Math.abs(frac - v) < 0.01);
  if (hit) return whole > 0 ? `${whole} ${hit[1]}` : hit[1];
  return String(Number(n.toFixed(3)));
}

/**
 * The density band real food occupies, in g/ml — the guard on any volume→mass answer.
 *
 * Wide on purpose, because both ends are real. Dried mushrooms from the owner's own test case run
 * about 0.075 g/ml (a 15 g portion is a loose handful); table salt is 1.2 and honey 1.4. A band this
 * wide does not catch a plausible-but-wrong answer — nothing can, which is why the answer gets
 * written back and reused rather than re-guessed. What it does catch is the failure that actually
 * happens: an order-of-magnitude slip, a per-ounce number filed as per-cup, or a unit the model
 * silently swapped.
 */
export const MIN_DENSITY_G_PER_ML = 0.03;
export const MAX_DENSITY_G_PER_ML = 2.5;

/** Beyond this, a single countable food item is not a food item. A whole turkey is ~10 kg. */
export const MAX_GRAMS_PER_ITEM = 15_000;

export interface PlausibilityVerdict {
  ok: boolean;
  /** Why not — phrased for the Coach to read, empty when ok. */
  reason: string;
}

/** Is this gram weight physically possible for the measure that was asked about? */
export function checkPlausible(measure: ParsedMeasure, grams: number): PlausibilityVerdict {
  if (!Number.isFinite(grams) || grams <= 0) {
    return { ok: false, reason: `a weight of ${grams} is not a weight` };
  }

  if (measure.kind === 'volume' && measure.ml && measure.ml > 0) {
    const density = grams / measure.ml;
    if (density < MIN_DENSITY_G_PER_ML || density > MAX_DENSITY_G_PER_ML) {
      return {
        ok: false,
        reason:
          `${Math.round(grams)} g in ${Math.round(measure.ml)} ml is a density of ${density.toFixed(2)} g/ml, ` +
          `outside the ${MIN_DENSITY_G_PER_ML}–${MAX_DENSITY_G_PER_ML} g/ml range real food occupies — ` +
          'the units were probably mixed up',
      };
    }
  }

  if (measure.kind === 'count' && grams / Math.max(1, measure.qty) > MAX_GRAMS_PER_ITEM) {
    return {
      ok: false,
      reason: `${Math.round(grams / measure.qty)} g for one is heavier than any single food item`,
    };
  }

  return { ok: true, reason: '' };
}

/**
 * Grams for ONE of a serving's unit, backing out any quantity baked into its label.
 *
 * A servings row is written by people and by four different source adapters, so its label may or
 * may not carry a quantity: "1/4 cup" at 40 g and "1 cup" at 160 g describe the same food. Reading
 * `amount_g` as a per-unit figure therefore under- or over-counts by whatever the label said, and
 * the error is silent — it just prices a meal wrong. Normalising both sides to one unit is the only
 * comparison that holds.
 */
export function gramsPerUnit(serving: FoodServing): number {
  const { qty } = parseLeadingQuantity(serving.label ?? '');
  const divisor = Number.isFinite(qty) && qty > 0 ? qty : 1;
  return serving.amount_g / divisor;
}
