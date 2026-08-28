/**
 * Reading a household measure, and knowing when an answer about one is physically impossible.
 *
 * The gap this serves is the owner's shallots case: *"USDA has shallots, but only by oz. Cadence
 * should be able to look up how much 1/4 c of shallots typically weighs and do that math."*
 *
 * `ABSOLUTE_UNITS` in `food-pricing-portion.ts` deliberately refuses cups, and that refusal is
 * correct — *"a food that has a cup serving should use its own cup, and one that doesn't should not
 * have a volume invented for it."* Grams per cup is a property of the FOOD, not of the unit: a cup
 * of shallots and a cup of honey share a volume and nothing else. So this module never converts a
 * GENERIC volume to mass — there is no cup→grams table here and there never will be.
 *
 * `scaleFromOwnMeasures` is the one narrow exception, and it is not a counter-example to the rule
 * above: it reads a food's OWN reported points — CNF prints its household measures as raw
 * "15 mL (16 g)" rows rather than under the name "tbsp", even though Health Canada's own
 * convention already IS 1 tbsp = 15 mL — and answers a NEARBY amount off the same line through the
 * origin. That is the food's own cup, spelled as a number instead of a word. It refuses rather
 * than extrapolate when nothing reported is close enough (`MAX_SCALE_RATIO`). Everything else
 * here — `parseMeasure`, `matchMeasure` — only says what was asked for, precisely enough that
 * something else can go and find out, and then checks the answer against physics.
 *
 * Nothing here talks to a model or a database; it is arithmetic and vocabulary, so it tests without
 * either.
 */

import type { Food, FoodServing } from '@cadence/shared';

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
  const { qty, rest: afterQty } = parseLeadingQuantity(raw);

  // A leading article is never part of the unit or the noun — "half AN egg" was leaving "an" as
  // the parsed unit (finding nothing, MASS_G/VOLUME_ML don't have it), so the noun for matching
  // came out "an" instead of "egg" and a food's own "1 egg" serving silently stopped matching a
  // request as ordinary as "half an egg". Only strips when parseLeadingQuantity left it behind —
  // "a cup" and "an egg" already consume the article as the quantity word itself.
  const rest = afterQty.replace(/^(a|an|the)\s+/i, '');

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

/**
 * Find the servings[] entry that answers a requested measure, or null when none does.
 *
 * Matched on the UNIT WORD, not on substring containment, which was a real bug: "680 g" contains
 * "g", so a containment match picked a "100 g" serving and priced the item at 68,000 g. A caught
 * unit is either the same unit or it is not.
 *
 * The one true serving-matcher: `food-source-report`'s candidate listing and
 * `food-pricing-portion`'s actual pricing both call this (the latter through the re-export below),
 * so "what does '1 tbsp' match" has one answer instead of two independently-written ones (MP0c).
 * It only ever finds an EXISTING row spelled the way the food itself spells it — it never derives
 * or scales one, which is what makes `matchMeasure(food, 'cup')` correctly say null for a food that
 * only carries a tablespoon. `scaleFromOwnMeasures`, below, is the function that takes that further.
 */
export function matchMeasure(food: Pick<Food, 'servings'>, requested: string | null | undefined): FoodServing | null {
  const want = (requested ?? '').trim().toLowerCase();
  if (!want) return null;
  const servings = Array.isArray(food.servings) ? food.servings : [];

  const exact = servings.find((s) => s.label.trim().toLowerCase() === want);
  if (exact) return exact;

  const parsed = parseMeasure(want);

  /**
   * A COUNT matches on the NOUN, because a stored count serving files its unit as 'item' — a row
   * for "1 shallot" carries unit 'item', so comparing units would never match "3 shallots" to it.
   * Singularised on both sides, since people write the plural and rows tend to hold the singular.
   */
  if (parsed.kind === 'count') {
    const noun = singular(parsed.countOf.split(/\s+/)[0] ?? '');
    if (!noun) return null;
    return (
      servings.find((s) => {
        const asCount = parseMeasure(s.label);
        return asCount.kind === 'count' && singular(asCount.countOf.split(/\s+/)[0] ?? '') === noun;
      }) ?? null
    );
  }

  const unit = parsed.unit.toLowerCase();
  if (!unit) return null;
  return (
    servings.find((s) => s.unit.trim().toLowerCase() === unit) ??
    // The label's own unit word, so "1 tbsp chopped" answers a request for tbsp.
    servings.find((s) => parseMeasure(s.label.trim().toLowerCase()).unit.toLowerCase() === unit) ??
    null
  );
}

/**
 * How far a request may sit from the food's own nearest reported point before `scaleFromOwnMeasures`
 * refuses to scale rather than guess. tsp↔tbsp is 3× apart; the evaporated-milk case (500 ml scaled
 * from the food's own 250 ml row) is 2×. A cup guessed from a single tablespoon row is 16× and MUST
 * stay refused — that is `matchMeasure`'s 'cup' test, one narrow floor below this one. 4× sits with
 * comfortable room on both sides of the real cases and well short of the one that must fail.
 */
export const MAX_SCALE_RATIO = 4;

/**
 * Grams (or ml, for a food already stored per ml) for a mass/volume amount that has no serving of
 * its own, scaled from the closest OTHER same-kind measure the food DOES carry — never a generic
 * density. See the module header for why this is not the same thing as inventing a conversion.
 *
 * MP1: CNF prints its household measures as raw "15 mL (16 g)", "250 mL (266.3 g)" rows — Health
 * Canada's own convention already IS 1 tsp = 5 mL, 1 tbsp = 15 mL, 1 cup = 250 mL, so "1 tbsp" has
 * no row spelled that way for `matchMeasure` to find, even though the row that answers it is
 * sitting right there under a different spelling. And a bare "500 ml" is not a named unit at all —
 * the food's closest point is 250 ml, and 500 is simply two of it. Both are the same operation:
 * take whichever of the food's own points is closest, and read the request off the same line
 * through the origin (the two points a food reports are never far from co-linear through zero,
 * because they are the same substance at different amounts).
 *
 * Picks the CLOSEST point by ratio (not array order — matching the first "…ml" row regardless of
 * its own size is the exact bug that made the recipe path disagree with the log path by 16× on
 * 500 ml of evaporated milk, MP0c) and refuses when even the closest is farther than
 * `MAX_SCALE_RATIO`.
 */
export function scaleFromOwnMeasures(
  servings: readonly FoodServing[],
  kind: 'mass' | 'volume',
  amount: number,
): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;

  let best: { ratio: number; scaled: number } | null = null;
  for (const s of servings) {
    const parsed = parseMeasure(s.label || s.unit || '');
    if (parsed.kind !== kind) continue;
    const per = kind === 'mass' ? parsed.grams : parsed.ml;
    if (per === null || per <= 0 || !Number.isFinite(s.amount_g) || s.amount_g <= 0) continue;

    const ratio = amount >= per ? amount / per : per / amount;
    if (!best || ratio < best.ratio) best = { ratio, scaled: (s.amount_g / per) * amount };
  }

  return best && best.ratio <= MAX_SCALE_RATIO ? best.scaled : null;
}
