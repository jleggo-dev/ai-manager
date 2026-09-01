/**
 * Req 5 Phase 3 — micronutrient insights (zinc / iron class).
 *
 * Pure: no DB, no LLM. Micros only from foods whose numbers were measured or transcribed from a
 * packet — see MICRO_TRUSTED_SOURCE for which sources those are and why.
 * Gate when coverage is thin — never invent a "likely low" from LLM-estimated meals.
 *
 * The FLOORS are not this file's to invent either. They come from the caller as resolved
 * `MicronutrientTarget`s — the published reference intakes for this person's sex and age, with any
 * number their doctor gave them standing in (`resolveMicronutrientTargets`). Two hardcoded
 * constants used to live here instead, zinc 7 and iron 8, written beside a table that already held
 * the answer and disagreeing with it: the app's own Nutrients screen told a 30-year-old woman she
 * needed 18mg of iron while this file stayed silent until she dropped under 8.
 */
import {
  MICRONUTRIENT_KEYS,
  macrosForLog,
  type Food,
  type FoodSource,
  type MicronutrientKey,
  type MicronutrientTarget,
  type NutritionLog,
} from '@cadence/shared';

export interface MicroInsightItem {
  kind: 'micro';
  body: string;
}

/**
 * Which sources' micronutrient numbers may drive a coaching line — one entry per FoodSource.
 *
 * A Record over the WHOLE union rather than a Set holding a subset, and that is the point: adding
 * a source to `FoodSource` now fails typecheck here until someone rules on it. The Set this
 * replaces was written when the union stopped at `off`, so `cnf` and `research` ended up excluded
 * by omission rather than by decision, and nothing anywhere said so.
 *
 * `cnf` — TRUE, and the correction that prompted this rewrite. Health Canada's Canadian Nutrient
 * File is a laboratory panel, not a label transcription: counted against the live `cadence.foods`
 * table on 2026-09-01, its 5,691 rows carry iron on 5,639 (99%) and zinc on 5,470 (96%), with a
 * value above zero on 97% and 94% of rows. It is also 99% of every food row we hold and the first
 * retrieval rung, so leaving it out did not make the coach careful — it made the zinc line
 * unreachable. Outside 19 usda rows, NO food in the table carried zinc at all: `off` had it on
 * 0 of 3 rows and `fatsecret` on 0 of 16.
 *
 * `research` — FALSE. It is a web-grounded AI lookup, and `completeness.ts` gives the reason in
 * full: an AI asked for the zinc in an Oreo will produce a number, and that number will be
 * invented. `food-research.ts` accepts micros "only as the label states them" and keeps their
 * provenance at 'label'. Pinning an answer makes it stable, not measured, and measurement is what
 * this file is gating on.
 *
 * `label_photo` / `off` / `fatsecret` — TRUE, unchanged. A transcribed panel is a person reading
 * real numbers off a packet. What a label leaves out stays out, which lowers coverage below the
 * gate rather than passing a fabricated zero through it.
 */
export const MICRO_TRUSTED_SOURCE: Record<FoodSource, boolean> = {
  usda: true,
  cnf: true,
  off: true,
  label_photo: true,
  fatsecret: true,
  llm: false,
  chat: false,
  manual: false,
  research: false,
};

/**
 * Speak at 70% of the target, not at the target itself.
 *
 * The old constants were commented "conservative likely-low floors, not clinical targets", and
 * that instinct was right even though the numbers were stale — a day's micro total is a FLOOR
 * (only foods we can read contribute), so someone sitting a little under their intake is much more
 * likely to be under-measured than undernourished. A fraction keeps that caution while letting the
 * reference table own the number: 70% of an unknown-sex zinc intake is 7.7mg, almost exactly the 7
 * this replaces, and it now moves correctly with sex, age, and anything their doctor said.
 */
const SPEAK_BELOW_FRACTION = 0.7;

/**
 * The two nutrients this surface speaks about unprompted.
 *
 * Not all eight, deliberately: the Nutrients screen already lists every one with its own shortfall
 * read, and a weekly coaching line that covered the same ground would be a checklist rather than a
 * nudge. Iron and zinc are here because they are the two whose shortfall shows up as how someone
 * FEELS — tiredness, slow recovery — which is the thing a coach would notice out loud. Anything
 * the user has explicitly asked her to watch is added on top (see `watchedTargets`).
 */
const ALWAYS_WATCHED: readonly MicronutrientKey[] = ['zinc_mg', 'iron_mg'];

/** Need enough linked real-data items before speaking. */
const MIN_LINKED_ITEMS = 3;
const MIN_DAYS_LOGGED = 3;
/** Of food-linked confirmed items, this fraction must carry the micro. */
const MIN_COVERAGE = 0.4;

export interface MicroCoverage {
  /** Trusted-source items that carried this nutrient at all. */
  covered: number;
  /** Their summed amount, in the nutrient's own unit. */
  total: number;
}

export interface MicroInsightRollup {
  days_logged: number;
  /** Confirmed log items that point at a food_id (any source). */
  linked_items: number;
  /** Per nutrient, and only for the ones some trusted food actually carried. */
  nutrients: Partial<Record<MicronutrientKey, MicroCoverage>>;
}

function isRealMicroFood(food: Food): boolean {
  return MICRO_TRUSTED_SOURCE[food.source] === true;
}

/**
 * Build a micro rollup from recent confirmed logs + loaded foods.
 * Scales via macrosForLog (default serving × item qty).
 */
export function buildMicroInsightRollup(
  recent: Array<Pick<NutritionLog, 'provisional' | 'items'>>,
  foodsById: Map<string, Food>,
  daysLogged: number,
): MicroInsightRollup {
  let linkedItems = 0;
  const nutrients: Partial<Record<MicronutrientKey, MicroCoverage>> = {};

  for (const row of recent) {
    if (row.provisional) continue;
    for (const item of row.items ?? []) {
      const foodId = typeof item.food_id === 'string' ? item.food_id : '';
      if (!foodId) continue;
      const food = foodsById.get(foodId);
      if (!food) continue;
      linkedItems += 1;
      if (!isRealMicroFood(food)) continue;

      const qty = typeof item.qty === 'number' && item.qty > 0 ? item.qty : 1;
      const scaled = macrosForLog(food, { quantity: qty });

      for (const key of MICRONUTRIENT_KEYS) {
        const value = scaled[key];
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        const bucket = (nutrients[key] ??= { covered: 0, total: 0 });
        bucket.covered += 1;
        bucket.total += value;
      }
    }
  }

  return { days_logged: daysLogged, linked_items: linkedItems, nutrients };
}

function coverageOk(covered: number, linkedItems: number, daysLogged: number): boolean {
  if (daysLogged < MIN_DAYS_LOGGED) return false;
  if (linkedItems < MIN_LINKED_ITEMS) return false;
  if (covered < MIN_LINKED_ITEMS) return false;
  return covered / linkedItems >= MIN_COVERAGE;
}

function avgPerDay(total: number, daysLogged: number): number {
  const d = Math.max(1, daysLogged);
  return total / d;
}

/**
 * Which resolved intakes this surface will speak about: the two standing ones, plus anything the
 * user was told from outside and asked her to hold. Ceilings never qualify — sodium's line is
 * "stay under", and running it through a "you look low" template would be actively bad advice.
 */
function watchedTargets(targets: MicronutrientTarget[]): MicronutrientTarget[] {
  return targets.filter((t) => t.direction === 'floor' && (ALWAYS_WATCHED.includes(t.key) || t.origin === 'override'));
}

/**
 * The hand-written lines, kept for the two nutrients that have always had them — shipped copy,
 * brand-checked, and better than any template. Neither states a number, so both still read
 * correctly when the floor behind them came from a doctor rather than the table.
 */
const WRITTEN_LINES: Partial<Record<MicronutrientKey, string>> = {
  zinc_mg:
    "From the foods I can read micros for, you're likely a little low on zinc this week — pumpkin seeds or chickpeas would help when you're next at the store.",
  iron_mg:
    "Iron looks a bit light in the foods I can measure — a handful of spinach or lentils would round that out. No pressure; just something I'm noticing.",
};

function bodyFor(target: MicronutrientTarget): string {
  const written = WRITTEN_LINES[target.key];
  if (written) return written;
  // An override is a number they went and got, so the line names it — that is the whole reason
  // it is on file, and saying it back is how they can tell us we wrote it down wrong.
  const against =
    target.origin === 'override'
      ? ` against the ${target.amount}${target.unit} you asked me to watch`
      : ' in the foods I can measure';
  return `${target.label} looks light${against} this week — ${target.sources} would help when you're next at the store. No pressure; just something I'm noticing.`;
}

/**
 * Coaching lines for the nutrients running short, given the intakes this person is coached against.
 *
 * `targets` comes from `resolveMicronutrientTargets` — pass an empty array and this says nothing,
 * which is the right answer when we could not work out who we are talking to.
 */
export function microInsights(rollup: MicroInsightRollup, targets: MicronutrientTarget[]): MicroInsightItem[] {
  const out: MicroInsightItem[] = [];

  for (const target of watchedTargets(targets)) {
    const seen = rollup.nutrients[target.key];
    if (!seen) continue;
    if (!coverageOk(seen.covered, rollup.linked_items, rollup.days_logged)) continue;
    if (avgPerDay(seen.total, rollup.days_logged) >= target.amount * SPEAK_BELOW_FRACTION) continue;
    out.push({ kind: 'micro', body: bodyFor(target) });
  }

  return out;
}
