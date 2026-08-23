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
import { priceFood } from './food-pricing-portion.ts';
import type { Food, FoodNutrients, FoodServing } from '@cadence/shared';

/** Which rung answered. `ledger` covers the user's own foods and the CNF corpus alike. */
export type FoodSourceName = 'ledger' | 'usda' | 'fatsecret' | 'research';

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

const MACRO_KEYS = ['kcal', 'protein_g', 'carbs_g', 'fat_g'] as const;

/** The measure to lead with when she did not name one: the food's own default, else 100 base. */
export function preferredServing(food: Food): FoodServing | null {
  const servings = Array.isArray(food.servings) ? food.servings : [];
  if (servings.length === 0) return null;
  const byDefault = servings[food.default_serving ?? 0];
  return byDefault ?? servings[0] ?? null;
}

/** Find the serving a requested measure names — loose match, because she types like a person. */
export function matchMeasure(food: Food, requested: string | null | undefined): FoodServing | null {
  const want = (requested ?? '').trim().toLowerCase();
  if (!want) return null;
  const servings = Array.isArray(food.servings) ? food.servings : [];
  return (
    servings.find((s) => s.label.toLowerCase() === want || s.unit.toLowerCase() === want) ??
    servings.find((s) => s.label.toLowerCase().includes(want) || want.includes(s.unit.toLowerCase())) ??
    null
  );
}

function measuresOf(food: Food): MeasureOption[] {
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
export function candidateNotes(food: Food, n: FoodNutrients): string[] {
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
  return notes;
}

/**
 * Shape one stored food into a candidate, priced at the measure she asked for.
 *
 * `priceFood` does the arithmetic on purpose: the model's job is to say WHICH measure matters, and
 * the store's job is to say how much that is. A model that returns calories it multiplied itself is
 * the variance the ledger exists to remove.
 */
export function toCandidate(food: Food, source: FoodSourceName, requestedMeasure?: string | null): SourceCandidate {
  const matched = matchMeasure(food, requestedMeasure) ?? preferredServing(food);
  const base = food.macros_per_base ?? {};

  const nutrients = matched ? priceFood(food, { qty: 1, unit: matched.unit, text: matched.label }) : base;
  const measureLabel = matched?.label ?? `100 ${food.base_unit}`;
  const grams = matched?.amount_g ?? (food.base_unit === 'item' ? 1 : 100);

  const notes = candidateNotes(food, base);
  if (requestedMeasure && !matchMeasure(food, requestedMeasure)) {
    notes.push(
      `This source has no "${requestedMeasure}" measure — the numbers above are per ${measureLabel}. ` +
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
