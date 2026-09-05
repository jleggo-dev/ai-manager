/**
 * One source's answer about one food, in the shape the Coach reasons over.
 *
 * Owner's contract (2026-08-23): a food lookup returns *"macros (calories, protein, carbs, fat) and
 * nutrients by a quantity of a measure — if it supports multiple, then the LLM tries to specify what
 * is most important. Let the LLM do the thinking with what is returned."*
 *
 * Two things follow from that sentence and they are the whole design of this file.
 *
 * BY A MEASURE, NOT PER 100 G. A stored food's numbers live per 100 g because that is what makes
 * them composable; nobody eats 100 g of anything on purpose. So a candidate states what ONE named
 * measure yields, and lists the other measures it could have stated, which is what lets her come
 * back and ask for a different one instead of doing the arithmetic herself.
 *
 * NOTHING IS PRE-FILTERED. The waterfall this replaces stopped at the first source clearing a
 * threshold, so a second opinion was not merely unused — it was never fetched. Adjudication is the
 * reasoning, and the reasoning is hers: every source that answered comes back, disagreements
 * included, with the guards' verdicts attached as `notes` rather than applied as a silent veto.
 */
import { microProvenance, nutritionTier, type NutritionTier } from './food-sources/completeness.ts';
import { matchMeasure, parseMeasure, scaleFromOwnMeasures } from './portion-measure.ts';
import { scaleNutrients, servingFactor, type Food, type FoodNutrients, type FoodServing } from '@cadence/shared';

/**
 * `matchMeasure` moved to `portion-measure.ts` (MP0c) so `food-pricing-portion.ts` can call the
 * same matcher without a circular import. Re-exported so nothing that imports it from here —
 * `portion-resolve.ts`, this file's own test — has to change.
 */
export { matchMeasure } from './portion-measure.ts';

/**
 * Which rung answered. `ledger` covers the user's own foods and the CNF corpus alike. `label` is a
 * nutrition-facts panel or front-of-package photo the person just attached and the Coach just read
 * (MP14, `read_label`) — see `SOURCE_AUTHORITY` below for how it ranks against the others.
 */
export type FoodSourceName = 'ledger' | 'usda' | 'fatsecret' | 'research' | 'label';

export interface MeasureOption {
  label: string;
  /** Grams (or ml, or item count) this measure represents — `FoodServing.amount_g` semantics. */
  grams: number;
}

export interface SourceCandidate {
  source: FoodSourceName;
  /** Null when the row is transient — researched or fetched but not yet stored. */
  food_id: string | null;
  name: string;
  brand: string | null;
  /** What one named measure actually yields. The answer to the question she asked. */
  per: {
    measure: string;
    grams: number | null;
    nutrients: FoodNutrients;
  };
  /** Everything else this row could be stated in, so a different measure is one more call. */
  measures: MeasureOption[];
  /**
   * Whether an ABSENT micronutrient means "measured and negligible" or "nobody looked".
   * Undecidable from a value, decidable from provenance — see `completeness.ts`.
   */
  micros: 'measured' | 'label' | 'none';
  completeness: NutritionTier;
  /** Guard verdicts and caveats, as evidence for her — never as a reason to drop the candidate. */
  notes: string[];
}

/**
 * Structural subset every candidate-shaping helper below actually reads. A saved `Food` satisfies
 * this trivially; so does an unsaved capture (`FoodCandidate`, food-capture-parse.ts) — MP14's
 * `read_label` reports what she just photographed the same way this file reports a stored food,
 * before it has ever been saved. `food_id` is exactly what a capture lacks, so it is optional here;
 * `toCandidate` reports it as `null`, same as a researched-but-unsaved row.
 */
type FoodLike = Pick<
  Food,
  'source' | 'name' | 'brand' | 'base_unit' | 'macros_per_base' | 'servings' | 'default_serving'
> & {
  food_id?: string | null;
};

/**
 * MP15 — how authoritative each rung is FOR THIS PRODUCT, most trustworthy first.
 *
 * Owner (2026-08-23), of a photographed nutrition-facts panel versus a web lookup for the same
 * product: *"she should actually prioritize the image, since it's a more authoritative source."*
 * The motivating artifact is a dried-mushroom jar whose panel reads "Per 15 pieces (15 g)" for a
 * recipe that calls for 15 pieces — the label answers the exact question, for the exact product, no
 * conversion. A `research` rung is the opposite: a generic web figure for a product-shaped guess,
 * usually per 100 g, that someone then has to convert against an assumed density. `ledger` (the
 * user's own foods and the CNF lab corpus) and `usda`/`fatsecret` sit between: structured, but not
 * guaranteed to be THIS product's own printed numbers.
 *
 * Ranking only — nothing here drops or reorders a fan-out's results by itself. `sortByAuthority` is
 * an opt-in a caller applies to a candidate LIST; a rung's own report (`toCandidate` below) always
 * still returns every candidate it is given. The fan-out's contract — every source that answered
 * comes back, disagreements included — does not change.
 */
export const SOURCE_AUTHORITY: Record<FoodSourceName, number> = {
  label: 0,
  ledger: 1,
  usda: 2,
  fatsecret: 2,
  research: 3,
};

/** Lower = more authoritative for this product. An unrecognised source sorts last, not first. */
export function sourceAuthority(source: FoodSourceName): number {
  return SOURCE_AUTHORITY[source] ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Most-authoritative-first. Stable, and NOTHING IS DROPPED — sorting is the only thing this does,
 * so a candidate that came back stays in the list regardless of where it ranks. Available for a
 * caller that renders a mixed list (a label read alongside a fan-out's web/database candidates) and
 * wants the ordering itself to carry the signal, on top of the notes toCandidate already attaches.
 */
export function sortByAuthority(candidates: readonly SourceCandidate[]): SourceCandidate[] {
  return [...candidates].sort((a, b) => sourceAuthority(a.source) - sourceAuthority(b.source));
}

const MACRO_KEYS = ['kcal', 'protein_g', 'carbs_g', 'fat_g'] as const;

/** The measure to lead with when she did not name one: the food's own default, else 100 base. */
export function preferredServing(food: FoodLike): FoodServing | null {
  const servings = Array.isArray(food.servings) ? food.servings : [];
  if (servings.length === 0) return null;
  const byDefault = servings[food.default_serving ?? 0];
  return byDefault ?? servings[0] ?? null;
}

function measuresOf(food: FoodLike): MeasureOption[] {
  const servings = Array.isArray(food.servings) ? food.servings : [];
  return servings
    .filter((s) => Number.isFinite(s.amount_g) && s.amount_g > 0)
    .map((s) => ({ label: s.label, grams: s.amount_g }));
}

/**
 * What the guards saw, said out loud.
 *
 * These used to be veto conditions that returned null and erased the record. A source that
 * disagrees with itself is *information* — it is the difference between "this row is unusable" and
 * "this row's energy and its macros do not agree, so treat its calories with suspicion" — and only
 * she can weigh that against what the other sources said.
 */
export function candidateNotes(food: FoodLike, n: FoodNutrients): string[] {
  const notes: string[] = [];

  const tier = nutritionTier(n);
  if (tier === 'unusable') notes.push('No usable numbers — calories are missing or stand alone.');
  else if (tier === 'partial') notes.push('Calories plus some nutrients, but not the full macro split.');

  // Atwater, stated rather than enforced: 4/4/9 is the arithmetic every label is built on.
  const { kcal, protein_g: p, carbs_g: c, fat_g: f } = n;
  if ([kcal, p, c, f].every((v) => typeof v === 'number')) {
    const implied = 4 * (p as number) + 4 * (c as number) + 9 * (f as number);
    const bigger = Math.max(implied, kcal as number);
    if (bigger >= 40 && Math.abs(implied - (kcal as number)) / bigger > 0.25) {
      notes.push(
        `Energy and macros disagree: the macros imply ~${Math.round(implied)} kcal but the record says ` +
          `${Math.round(kcal as number)}. One of the two is wrong and this source does not say which.`,
      );
    }
  }

  if (microProvenance(n) === 'label') {
    notes.push('Micronutrients come from a printed label, so an absent one is unknown, not zero.');
  }

  if (food.source === 'llm' || food.source === 'research') {
    notes.push(`Estimated (${food.source}), not measured — prefer a lab-analysed source if one agrees.`);
  }
  // MP15: the provenance-level twin of the rung-level note toCandidate adds below — this one fires
  // off the FOOD's own recorded source, so it still applies to a label-derived row found again later
  // via `ledger`, not only on the turn it was first read.
  if (food.source === 'label_photo') {
    notes.push(
      "Read from a photographed nutrition label for this exact product — the maker's own printed " +
        'figures for it, at its own printed serving.',
    );
  }
  return notes;
}

/**
 * Grams for ONE of the requested measure, scaled from the food's OWN reported points when no
 * serving names it directly (MP1) — the same reach `portionFactor` gets, applied here so asking
 * about "1 tbsp" doesn't cost a round trip through resolve_portion when the CNF row that already
 * answers it is sitting in `servings[]` spelled "15 mL". Normalises to ONE unit first (dividing
 * the parsed quantity back out), matching this file's existing contract of reporting per ONE named
 * measure regardless of how many were asked for — see `toCandidate` below.
 */
function deriveOneUnit(servings: readonly FoodServing[], requested: string): { grams: number; label: string } | null {
  const parsed = parseMeasure(requested);
  if (parsed.kind !== 'mass' && parsed.kind !== 'volume') return null;
  const total = parsed.kind === 'mass' ? parsed.grams : parsed.ml;
  const perOne = total !== null && parsed.qty > 0 ? total / parsed.qty : null;
  if (perOne === null || !(perOne > 0)) return null;
  const grams = scaleFromOwnMeasures(servings, parsed.kind, perOne);
  return grams === null ? null : { grams, label: `1 ${parsed.unit}` };
}

/**
 * Nutrients for ONE of `serving`, priced directly from its own `amount_g` — never through
 * `priceFood`/`portionFactor`'s `{unit, qty}` request-parsing interface.
 *
 * That interface is for re-resolving something a PERSON typed ("170 g", "1/4 cup") against a
 * food's servings from scratch, and its first step deliberately treats a bare mass/volume unit
 * word as an ABSOLUTE amount when it matches the food's own `base_unit` — correct for "log 1 g of
 * X", wrong here. `toCandidate` has ALREADY found the exact serving object to report (`exact` from
 * `matchMeasure`, or `matched` from `preferredServing`); asking `portionFactor` to re-derive it
 * from `{unit: serving.unit, qty: 1}` re-enters that same absolute-unit branch whenever the
 * serving's own unit happens to be a bare "g"/"ml" equal to the food's base — so a serving genuinely
 * labelled "15 g" on a `base_unit:'g'` food priced at 1/100th of ONE GRAM, not at the 15 g the
 * serving actually names (confirmed against `parse-nutrition-label`'s own worked example: the
 * mushroom jar that motivates this parcel prints exactly "Per 15 pieces (15 g)", `serving_unit:"g"`
 * — this is not a hypothetical, it was live on `main`). `servingFactor` reads
 * `serving.amount_g` directly and never re-parses a unit word, so there is nothing left to misread.
 */
function nutrientsAtServing(base: FoodNutrients, baseUnit: Food['base_unit'], serving: FoodServing): FoodNutrients {
  return scaleNutrients(base, servingFactor(baseUnit, serving, 1));
}

/**
 * Shape one stored food into a candidate, priced at the measure she asked for.
 *
 * The store does the arithmetic on purpose: the model's job is to say WHICH measure matters, and
 * the store's job is to say how much that is. A model that returns calories it multiplied itself is
 * the variance the ledger exists to remove. See `nutrientsAtServing` above for why that arithmetic
 * is `servingFactor`/`scaleNutrients` directly rather than a round trip through `priceFood`.
 */
export function toCandidate(food: FoodLike, source: FoodSourceName, requestedMeasure?: string | null): SourceCandidate {
  const base = food.macros_per_base ?? {};
  const servings = Array.isArray(food.servings) ? food.servings : [];
  const exact = matchMeasure(food, requestedMeasure);
  const derived = !exact && requestedMeasure ? deriveOneUnit(servings, requestedMeasure) : null;

  let nutrients: FoodNutrients;
  let measureLabel: string;
  let grams: number;
  if (exact) {
    nutrients = nutrientsAtServing(base, food.base_unit, exact);
    measureLabel = exact.label;
    grams = exact.amount_g;
  } else if (derived) {
    nutrients = scaleNutrients(base, derived.grams / 100);
    measureLabel = derived.label;
    grams = derived.grams;
  } else {
    const matched = preferredServing(food);
    nutrients = matched ? nutrientsAtServing(base, food.base_unit, matched) : base;
    measureLabel = matched?.label ?? `100 ${food.base_unit}`;
    grams = matched?.amount_g ?? (food.base_unit === 'item' ? 1 : 100);
  }

  const notes = candidateNotes(food, base);
  if (requestedMeasure && !exact) {
    notes.push(
      derived
        ? `This source has no "${requestedMeasure}" row — the numbers above are scaled from its own ` +
            'measures, not printed.'
        : `This source has no "${requestedMeasure}" measure — the numbers above are per ${measureLabel}. ` +
            'Use resolve_portion to convert, rather than assuming a density.',
    );
  }

  return {
    source,
    food_id: food.food_id || null,
    name: food.name,
    brand: food.brand ?? null,
    per: { measure: measureLabel, grams, nutrients },
    measures: measuresOf(food),
    micros: microProvenance(base),
    completeness: nutritionTier(base),
    notes,
  };
}

/**
 * Where the sources disagree, computed once so she does not have to hold four rows in her head.
 *
 * Normalised per 100 g before comparing, because two sources stating the same food in different
 * measures are not actually disagreeing — that comparison is the mistake this function exists to
 * not make.
 */
export function findDisagreements(candidates: SourceCandidate[]): string[] {
  const out: string[] = [];
  const per100 = candidates
    .map((c) => {
      const kcal = c.per.nutrients.kcal;
      if (typeof kcal !== 'number' || !c.per.grams || c.per.grams <= 0) return null;
      return { source: c.source, name: c.name, kcal100: (kcal * 100) / c.per.grams };
    })
    .filter((x): x is { source: FoodSourceName; name: string; kcal100: number } => x !== null);

  if (per100.length >= 2) {
    const sorted = [...per100].sort((a, b) => a.kcal100 - b.kcal100);
    const low = sorted[0]!;
    const high = sorted[sorted.length - 1]!;
    if (high.kcal100 > 0 && (high.kcal100 - low.kcal100) / high.kcal100 > 0.25) {
      out.push(
        `Calories differ by more than a quarter per 100 g: ${low.source} says ~${Math.round(low.kcal100)} ` +
          `(${low.name}), ${high.source} says ~${Math.round(high.kcal100)} (${high.name}). ` +
          'They may not be describing the same food.',
      );
    }
  }

  const measured = candidates.filter((c) => c.micros === 'measured');
  if (measured.length > 0 && candidates.some((c) => c.micros === 'label')) {
    out.push(
      `${measured.map((c) => c.source).join(', ')} carr${measured.length === 1 ? 'ies' : 'y'} a lab panel; ` +
        'the others are label transcriptions. Prefer the analysed one for micronutrients.',
    );
  }
  return out;
}

/** Does this candidate carry the four macros the day is computed from? */
export function hasFullMacros(c: SourceCandidate): boolean {
  return MACRO_KEYS.every((k) => typeof c.per.nutrients[k] === 'number');
}
