import type { Food, FoodNutrients } from '@cadence/shared';

/**
 * How complete a food's nutrition is, and — the harder half — whether we are entitled to say so.
 *
 * The owner framed the question exactly right: *"what does complete mean? From the user's
 * perspective it means macros and micronutrients, although in most cases they'd be okay with just
 * macros. And it will be hard to tell with micronutrients, because honestly some foods just don't
 * have any."*
 *
 * The first half is easy and is the bar this file enforces: kcal plus the four macros. The second
 * half is genuinely undecidable from a record alone, because a nutrient that is absent because the
 * food has none and a nutrient that is absent because nobody measured it look identical — both are
 * simply not there. Getting it wrong in either direction is bad: claim a food has no iron and we
 * imply a deficiency that is not real; claim we do not know and we hide data we actually hold.
 *
 * THE WAY OUT IS PROVENANCE, NOT THE VALUE. Measured across USDA's datasets (2026-08-23, average
 * nutrients published per record):
 *
 *     SR Legacy 77.5 · Survey (FNDDS) 65 · Foundation 22 · Branded 13.7
 *
 * The first three are laboratory panels. Branded is a transcription of the Nutrition Facts label,
 * and US labelling rules require only sodium, vitamin D, calcium, iron and potassium. Zinc, vitamin
 * B-12 and vitamin C are not on a modern label at all — so a record carrying ANY of them was
 * measured rather than transcribed, and in a measured record an absence is a real answer.
 *
 * Which is how the Oreo question resolves. An Oreo is not nutrient-free — it has sodium and fibre,
 * both printed on the packet. What we cannot know from its Branded row is its zinc, because the
 * label was never going to say either way. So we do not claim, and we do not go looking: an AI
 * asked to research the zinc content of an Oreo will produce a number, and that number will be
 * invented. Absence of proof, said plainly, beats a confident fiction.
 */
export type NutritionTier =
  /**
   * Cannot contribute to a day. Either no calories at all, or calories and literally nothing else —
   * a stub row that any real source would beat. This is the only tier that makes the waterfall
   * spend another rung.
   */
  | 'unusable'
  /** Calories and something, but not the full macro split. Usable, and most foods live here. */
  | 'partial'
  /** Calories and all four macros — what every target and every ring is computed from. */
  | 'macros'
  /** Macros plus a MEASURED micronutrient panel — what the Nutrients screen can speak from. */
  | 'full';

const CORE_MACROS = ['protein_g', 'carbs_g', 'fat_g'] as const;

/**
 * Nutrients no modern US Nutrition Facts panel carries, so their presence proves a lab measurement.
 *
 * Vitamin C was dropped from mandatory labelling in the 2016 refresh; zinc and B-12 were never
 * required. If one of these is on the record, the source analysed the food rather than reading its
 * packet — and every other absence on that record therefore means "measured, and negligible".
 */
const LAB_ONLY_MICROS = ['zinc_mg', 'vitamin_b12_ug', 'vitamin_c_mg'] as const;

/** Whether this food's numbers came from an analysis rather than a label transcription. */
export function microsAreMeasured(n: FoodNutrients | null | undefined): boolean {
  if (!n) return false;
  return LAB_ONLY_MICROS.some((k) => typeof n[k] === 'number');
}

export function nutritionTier(n: FoodNutrients | null | undefined): NutritionTier {
  if (!n || typeof n.kcal !== 'number') return 'unusable';
  // Calories and nothing whatsoever is a stub. One other nutrient is enough to be a real row:
  // a yogurt at 59 kcal with 10 g protein and 110 mg calcium prices a breakfast perfectly well.
  const others = Object.entries(n).filter(([k, v]) => k !== 'kcal' && k !== 'source' && typeof v === 'number');
  if (others.length === 0) return 'unusable';
  if (!CORE_MACROS.every((k) => typeof n[k] === 'number')) return 'partial';
  return microsAreMeasured(n) ? 'full' : 'macros';
}

/**
 * Is this good enough to stop looking?
 *
 * YES AT `partial`, WHICH IS LOWER THAN IT FIRST LOOKS. The rungs below cost real things —
 * FatSecret bills a call every time it prices, an AI research call costs seconds of someone's
 * attention and is the one source whose answer changes between asks. So the bar is what a food
 * needs to CONTRIBUTE, not what would be nice to have.
 *
 * The first version of this demanded all four macros and was wrong: it sent a Greek yogurt row of
 * 59 kcal / 10 g protein / 110 mg calcium down a billed rung to fetch numbers it did not need,
 * and nine existing tests said so immediately. Most real ledger rows are partial and perfectly
 * good. Only a stub — no calories, or calories and nothing else — is worth paying to replace.
 *
 * And NEVER for micronutrients. Chasing them would spend a real rung on the half we cannot verify,
 * for a food whose label was never going to say either way, then pin the answer forever.
 */
export function isGoodEnough(n: FoodNutrients | null | undefined): boolean {
  return nutritionTier(n) !== 'unusable';
}

/** The same question about a stored row, which is where the waterfall actually asks it. */
export function foodIsGoodEnough(food: Food | null | undefined): boolean {
  return isGoodEnough(food?.macros_per_base);
}

/**
 * What to tell someone about a food's micronutrients, in the only three honest states.
 *
 * `measured` — analysed; an absent nutrient is genuinely negligible and may be said so.
 * `label`    — transcribed from a packet; absences are unknown and must never read as zero.
 * `none`     — we hold no micronutrient data at all for this food.
 */
export function microProvenance(n: FoodNutrients | null | undefined): 'measured' | 'label' | 'none' {
  if (microsAreMeasured(n)) return 'measured';
  const anyMicro =
    n && (['sodium_mg', 'iron_mg', 'calcium_mg', 'potassium_mg'] as const).some((k) => typeof n[k] === 'number');
  return anyMicro ? 'label' : 'none';
}
