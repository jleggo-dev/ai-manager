import type { FoodBaseUnit, FoodNutrients, FoodServing } from '@cadence/shared';

/**
 * The contract every food source must satisfy before its numbers reach the ledger.
 *
 * WHY THIS EXISTS. Three separate outages in the food stack were all the same bug wearing
 * different clothes, and every one was silent:
 *
 *   · USDA Branded reports nutrients under a legacy numbering (208, not 1008), so every packaged
 *     food mapped to no nutrients at all and was rejected as unmappable.
 *   · USDA Foundation often reports no "Energy" row whatsoever — only Atwater factors (957/958) —
 *     so whole foods imported with ZERO CALORIES and contributed nothing to the day.
 *   · FatSecret writes `potassium: 0` to mean "we don't have this", so absent micros arrived as
 *     confident zeroes.
 *
 * None threw. Each looked exactly like "that food isn't in this source", which is a normal answer,
 * so each survived until a person noticed their lunch was wrong. The mappers were already adapters
 * in all but name; what was missing was anything that said what an adapter OWES — so each one
 * drifted on its own and each gap stayed invisible.
 *
 * The check that earns its keep is `kcal ≈ 4p + 4c + 9f`. It knows nothing about USDA's numbering
 * or FatSecret's JSON, and it would have caught two of the three above on the day they shipped:
 * a food carrying macros but no calories is not a food, it is a mapping bug.
 *
 * This is a GUARD, not a validator: it reports, and the caller drops the offending field. A source
 * having one bad row must never take down the rung — the waterfall's whole design is that a rung
 * which cannot answer is skipped, not fatal.
 */
export interface NormalizedFood {
  name: string;
  brand: string | null;
  base_unit: FoodBaseUnit;
  /** Per 100 g / 100 ml / 1 item, per `base_unit`. */
  macros_per_base: FoodNutrients;
  servings: FoodServing[];
  default_serving: number;
  /** Set when the source says the food contains ethanol — it exempts the energy cross-check. */
  alcoholic?: boolean;
}

export interface NormalizationProblem {
  field: string;
  detail: string;
  /**
   * `drop`  — unusable, discard the food entirely.
   * `field` — the value is impossible (negative, or more than 100 g inside 100 g); discard it.
   * `warn`  — it is suspicious, not impossible. SAY SO AND KEEP IT.
   *
   * The third one is the important one. When a source's stated energy disagrees with its own
   * macros, one of the two is wrong and we do not know which — the macros could be the ones read
   * per-serving instead of per-100g. Deleting the publisher's number and substituting arithmetic
   * tuned on fifteen sampled foods would be us overruling USDA on a hunch, and worse, it would
   * MASK the mapping bug by making the result look plausible again. A smoke detector reports; it
   * does not rewrite the building.
   */
  severity: 'drop' | 'field' | 'warn';
}

const BASE_UNITS: readonly FoodBaseUnit[] = ['g', 'ml', 'item'];

/**
 * Atwater: 4 kcal/g protein, 4 carbs, 9 fat. The arithmetic every nutrition label is built on.
 *
 * ALL THREE or nothing. A partial set implies a number that is arithmetically fine and completely
 * meaningless — a food listing only protein "implies" 4 kcal, which would then accuse a perfectly
 * correct 89 kcal of being wrong. The check is only allowed to speak when it actually knows.
 */
export function atwaterKcal(n: FoodNutrients): number | null {
  const p = n.protein_g;
  const c = n.carbs_g;
  const f = n.fat_g;
  if (typeof p !== 'number' || typeof c !== 'number' || typeof f !== 'number') return null;
  return 4 * p + 4 * c + 9 * f;
}

/**
 * How far a stated kcal may sit from its macros before we stop believing it.
 *
 * MEASURED, not guessed (2026-08-23, 15 USDA foods chosen to stress the check — bran, oils, nuts,
 * fortified cereal, pulses, dairy, leaves). Real deviation runs to 7.6% at p90 and 0.1–2% for most
 * foods; USDA computes energy with per-food Atwater factors, and fibre — a carbohydrate yielding
 * ~2 kcal/g rather than 4 — accounts for nearly all of the spread. 25% leaves better than 3×
 * headroom over anything legitimate while still catching what a mapping bug looks like: a missing
 * value, a 10× slip, a unit read as the wrong scale. An earlier 35% cleared every one of those
 * real foods too, but only by giving up the ability to notice anything subtler than an order of
 * magnitude — a guard nobody trusts to fire is the bug it was meant to prevent.
 *
 * The floor exists because ratios are meaningless near zero: raw spinach states 23 kcal against 30
 * implied, which is 22% and also seven calories on a leaf.
 */
const KCAL_TOLERANCE = 0.25;
const KCAL_FLOOR = 50;

/**
 * Missing energy is judged at a lower floor than disagreeing energy.
 *
 * "These numbers round differently" needs a food big enough for the ratio to mean something.
 * "There is no energy value at all" does not — it is unambiguous at any size, and it is the exact
 * shape of the Foundation/Atwater bug, so it gets to speak sooner.
 */
const KCAL_MISSING_FLOOR = 25;

/**
 * Drinks whose calories are mostly ethanol — for sources that publish NO alcohol figure.
 *
 * USDA states alcohol as a nutrient (id 1018 / number 221), so its adapter knows from the data.
 * FatSecret does not publish one at all: a Red Table Wine row carries calories, carbohydrate,
 * protein, fat and calcium, and nothing else. Its 85 kcal against ~11 implied is therefore
 * flagged forever with no way to answer — and a guard that cries wolf on every glass of wine is
 * a guard people stop reading.
 *
 * A name is weak evidence, and it is used here only because the cost of being wrong is so
 * lopsided. A FALSE POSITIVE (matching "wine vinegar" or "rum cake") merely SUPPRESSES A WARNING;
 * it can never change a number, and the impossible-value checks, which are the ones that actually
 * drop data, run regardless. Getting it wrong costs a little vigilance on one row; getting it
 * right buys back a check nobody was reading.
 */
const ALCOHOL_WORDS =
  /\b(?:wine|beer|ale|lager|stout|cider|vodka|gin|rum|whisk(?:e)?y|bourbon|scotch|tequila|brandy|cognac|liqueur|schnapps|sake|prosecco|champagne|vermouth|absinthe|mead|shandy|sangria|margarita|mojito|martini)\b/i;

export function looksAlcoholic(name: string): boolean {
  return ALCOHOL_WORDS.test(name);
}

export function checkNormalizedFood(food: NormalizedFood): NormalizationProblem[] {
  const problems: NormalizationProblem[] = [];

  if (!food.name.trim()) {
    problems.push({ field: 'name', detail: 'a food with no name cannot be recognised again', severity: 'drop' });
  }
  if (!BASE_UNITS.includes(food.base_unit)) {
    problems.push({ field: 'base_unit', detail: `unknown base unit ${food.base_unit}`, severity: 'drop' });
  }

  for (const [key, value] of Object.entries(food.macros_per_base)) {
    if (key === 'source') continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      problems.push({ field: key, detail: `${key} is not a finite number`, severity: 'field' });
      continue;
    }
    /**
     * An IMPOSSIBLE value condemns the whole record, not just the field.
     *
     * Negative nutrients are meaningless, and more than 100 g of anything inside 100 g cannot
     * happen (900 kcal can, hence the exemption). When one appears, the record's BASIS is wrong —
     * USDA publishes a Starbucks K-Cup row at 262.5 g carbs, 50 g protein and 875 mg sodium per
     * 100 g, which is per-package values filed as per-100g. Dropping only the one field that
     * happens to exceed the limit would leave the other numbers, equally wrong and now perfectly
     * plausible, to be pinned and reused forever. Plausible-and-wrong is the worst of the three
     * outcomes; missing is merely a gap, and the next rung of the waterfall fills it.
     */
    if (value < 0) {
      problems.push({
        field: key,
        detail: `${key}=${value} is negative — the record is not trustworthy`,
        severity: 'drop',
      });
    } else if (key.endsWith('_g') && !key.endsWith('_ug') && value > 100) {
      problems.push({
        field: key,
        detail: `${key}=${value} exceeds 100 per 100 units — the whole record's basis is wrong`,
        severity: 'drop',
      });
    }
  }

  problems.push(...checkEnergy(food.macros_per_base, food.alcoholic === true || looksAlcoholic(food.name)));
  problems.push(...checkServings(food));
  return problems;
}

function checkEnergy(n: FoodNutrients, alcoholic: boolean): NormalizationProblem[] {
  const implied = atwaterKcal(n);
  if (implied === null) return [];
  /**
   * Ethanol yields ~7 kcal/g and is not a protein, a carbohydrate or a fat, so a drink's calories
   * legitimately have almost nothing to do with its macros — the survey caught vodka at 231 kcal
   * against 0 implied, and red wine at 85 against 11. Both are correct. Atwater simply has no
   * opinion here, so it does not get to have one.
   */
  if (alcoholic) return [];

  if (typeof n.kcal !== 'number') {
    // The Foundation-Atwater bug, caught without knowing anything about USDA.
    if (implied >= KCAL_MISSING_FLOOR) {
      return [
        {
          field: 'kcal',
          detail: `macros imply ~${Math.round(implied)} kcal but none was mapped`,
          severity: 'field',
        },
      ];
    }
    return [];
  }

  // Both present: are they telling the same story? Only meaningful above the floor, where a few
  // absolute calories of rounding stop dominating the ratio.
  const bigger = Math.max(n.kcal, implied);
  if (bigger < KCAL_FLOOR) return [];
  if (Math.abs(n.kcal - implied) / bigger > KCAL_TOLERANCE) {
    return [
      {
        field: 'kcal',
        detail: `kcal=${n.kcal} disagrees with macros implying ~${Math.round(implied)}`,
        severity: 'warn',
      },
    ];
  }
  return [];
}

function checkServings(food: NormalizedFood): NormalizationProblem[] {
  const problems: NormalizationProblem[] = [];
  food.servings.forEach((s, i) => {
    if (!(typeof s.amount_g === 'number' && Number.isFinite(s.amount_g) && s.amount_g > 0)) {
      problems.push({ field: `servings[${i}]`, detail: 'serving amount must be positive', severity: 'field' });
    }
    if (!s.label?.trim()) {
      problems.push({ field: `servings[${i}]`, detail: 'serving has no label', severity: 'field' });
    }
  });

  // An out-of-range default silently shows the WRONG portion preselected — the user then logs a
  // number they never chose, which is exactly the class of error this whole surface exists to stop.
  if (food.servings.length > 0 && (food.default_serving < 0 || food.default_serving >= food.servings.length)) {
    problems.push({
      field: 'default_serving',
      detail: `default_serving ${food.default_serving} is outside 0..${food.servings.length - 1}`,
      severity: 'field',
    });
  }
  return problems;
}

/**
 * Apply the guard: log what is wrong, discard only what cannot be trusted, and say whether the
 * food may be used at all. Dropping a nutrient beats keeping a wrong one — since A23 an unmatched
 * food is PINNED, so a plausible-looking wrong number does not get corrected tomorrow, it gets
 * reused forever.
 */
export function applyNormalization<T extends NormalizedFood>(source: string, food: T): T | null {
  const problems = checkNormalizedFood(food);
  if (problems.length === 0) return food;

  for (const p of problems) {
    console.warn(`[${source}] ${food.name || '(unnamed)'}: ${p.detail}`);
  }
  if (problems.some((p) => p.severity === 'drop')) return null;

  const macros: Record<string, unknown> = { ...food.macros_per_base };
  for (const p of problems) {
    if (p.severity === 'field' && p.field in macros) delete macros[p.field];
  }

  /**
   * Energy the source never stated, computed the way a label computes it.
   *
   * USDA's own OREO COOKIES row carries seven nutrients and no energy at all — their gap, not a
   * mapping bug, and no amount of adapter work will conjure a row that was never published. The
   * choice is therefore between a food worth 0 kcal and a food worth what its macros say. Zero is
   * not the conservative option: it is a confident wrong answer that silently deflates the day,
   * and since A23 it gets PINNED and repeats. Atwater is not a guess either — it is the same
   * arithmetic the manufacturer used to print the number on the packet.
   *
   * Only ever fills a HOLE. A stated energy is never overwritten, however much we disagree with it.
   */
  if (typeof macros.kcal !== 'number' && !food.alcoholic) {
    const implied = atwaterKcal(macros as FoodNutrients);
    if (implied !== null && implied >= KCAL_MISSING_FLOOR) {
      macros.kcal = Math.round(implied * 10) / 10;
      console.warn(`[${source}] ${food.name}: energy not published — derived ${macros.kcal} kcal from macros`);
    }
  }

  return { ...food, macros_per_base: macros as FoodNutrients };
}
