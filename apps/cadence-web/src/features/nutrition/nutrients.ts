import {
  MICRONUTRIENT_KEYS,
  microStatus,
  resolveMicronutrientTargets,
  type MicronutrientKey,
  type MicronutrientTarget,
  type MicroTargetOverride,
} from '@cadence/shared';
import type { Meal, MealMacros } from '../../lib/api.ts';

/**
 * The Nutrients drill-down's view model (Food Journey 09/5C) — the read that turns eight numbers
 * the app has always carried into something a person can act on.
 *
 * Two directions that must never look alike (`micronutrient-targets.ts` is emphatic, and so is the
 * frame): a **floor** is "eat at least this" and a **ceiling** is "stay under this one". Sodium is
 * the only ceiling. Rendering a ceiling as a goal to reach would be actively bad advice, so the
 * split happens here, in data, rather than in a component's styling.
 *
 * Three honesty rules, all of them the same rule:
 *
 *  1. **A met floor is silence, not a tick.** "AIMING TO REACH THESE" only ever lists floors that
 *     are actually short (BRAND: count what happened, never what broke). Everything else drops to
 *     "also counted", where it is present and unremarked. If nothing is short the section is
 *     simply absent — that IS the reward.
 *  2. **A total is a floor, not a measurement.** Micros only arrive with food we have real data
 *     for, so a meal typed in words contributes its calories and no minerals. `counted` carries
 *     the N-of-M so the screen can say which, and the copy says these read LOW rather than wrong.
 *  3. **No data is not a shortfall.** When nothing logged today carried a single micronutrient,
 *     `unmeasured` is set and the shortfall list is suppressed entirely — otherwise a person who
 *     hand-typed their lunch would be shown three deficiencies they did not have.
 */

/** Every micronutrient key the day totals can carry — the same eight `micronutrientTargets` covers. */
const MICRO_KEYS = MICRONUTRIENT_KEYS as Array<keyof MealMacros>;

export interface NutrientReading {
  key: string;
  label: string;
  direction: 'floor' | 'ceiling';
  /** 0–999, capped so one wild outlier cannot blow up a bar. */
  pct: number;
  /** An unmet floor. A met one says nothing. */
  short: boolean;
  /** A breached ceiling — stated as a fact by the number, never shouted by the bar. */
  over: boolean;
  /** "14" / "1,940" — already scaled to `unit`. */
  eatenText: string;
  /** "18" / "2,300" — likewise. */
  targetText: string;
  /** The unit these two texts are in, which is not always the reference intake's own. */
  unit: string;
  why: string;
  /** True when this number is one they were told outside the app, not the published figure. */
  overridden: boolean;
}

export interface NutrientsView {
  /** Floors that are short, shortest first, at most three — the frame's featured block. */
  aiming: NutrientReading[];
  /** Sodium, and only ever sodium. */
  ceiling: NutrientReading | null;
  /** Everything else, in reference-table order: present, counted, unremarked. */
  also: NutrientReading[];
  /** How much of what was logged could actually be read for minerals. */
  counted: { measured: number; total: number };
  /** Nothing on file carried a micronutrient — say so rather than draw eight zeros. */
  unmeasured: boolean;
}

/**
 * How to say a reference intake out loud. Milligrams stop being readable once the intake runs into
 * the thousands, so potassium reads "2.9 of 3.4 g" while sodium stays in mg — the frame's own
 * choice, and the reason this is derived from the target rather than hard-coded per nutrient.
 */
function display(t: MicronutrientTarget): { unit: string; scale: number; dp: number } {
  if (t.unit === 'mg' && t.amount >= 3000) return { unit: 'g', scale: 0.001, dp: 1 };
  if (t.unit === 'µg') return { unit: 'µg', scale: 1, dp: 1 };
  return { unit: t.unit, scale: 1, dp: 0 };
}

function num(n: number, dp: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Does this set of numbers carry any micronutrient at all, or is it macros-only? */
export function hasMicros(m?: MealMacros | null): boolean {
  if (!m) return false;
  return MICRO_KEYS.some((k) => {
    const v = m[k];
    return typeof v === 'number' && v > 0;
  });
}

/**
 * "Counted from N of your M items." Items are the unit a person recognises — they typed four
 * things into lunch, not one lunch.
 *
 * Micros can be recorded per item (a resolved food) or only at the meal level (a label read, a
 * recipe). So an item counts as measured if it carries micros itself; failing that, if the meal
 * does AND no sibling item carries any, the meal's data is credited across its items rather than
 * reported as zero coverage while real numbers sit in the totals.
 *
 * Provisional meals are excluded on both sides, because the day's totals exclude them too.
 */
export function countMeasured(meals: Meal[]): { measured: number; total: number } {
  let measured = 0;
  let total = 0;
  for (const meal of meals) {
    if (meal.provisional) continue;
    const items = meal.items?.length ? meal.items : [{ name: '' }];
    const perItem = items.some((i) => hasMicros(i.est));
    const atMealLevel = hasMicros(meal.macros);
    for (const item of items) {
      total += 1;
      if (perItem ? hasMicros(item.est) : atMealLevel) measured += 1;
    }
  }
  return { measured, total };
}

/** `Macros` also carries a non-numeric `source`, so a keyed read has to prove it found a number. */
function amountOf(totals: MealMacros, key: keyof MealMacros): number | undefined {
  const v = totals[key];
  return typeof v === 'number' ? v : undefined;
}

function reading(t: MicronutrientTarget, eaten: number | undefined): NutrientReading {
  const { pct, short, over } = microStatus(t, eaten);
  const d = display(t);
  const got = typeof eaten === 'number' && Number.isFinite(eaten) ? eaten : 0;
  return {
    key: String(t.key),
    label: t.label,
    direction: t.direction,
    pct,
    short,
    over,
    eatenText: num(got * d.scale, d.dp),
    targetText: num(t.amount * d.scale, d.dp),
    unit: d.unit,
    why: t.why,
    overridden: t.origin === 'override',
  };
}

/** How many floors the featured block will ever show — three is a read, seven is a chore. */
const AIMING_MAX = 3;

/**
 * Build the drill-down from a day's (or a week-average's) totals and the meals behind them.
 *
 * Reference intakes come from the published adult table with no age or sex applied: the web has
 * neither on hand, and `micronutrientTargets` answers an empty argument with the more cautious
 * figure of each pair by design. The copy must therefore not claim to be personalised.
 *
 * `overrides` is the exception, and it rides in on `day.targets.micro_targets` — a number this
 * person was given outside the app (owner ruling 2026-09-01). It is passed through rather than
 * looked up so this screen and the coach's own micro lines read the SAME figure: two surfaces
 * quoting different targets for the same nutrient is the failure this whole change came out of.
 */
export function buildNutrientsView(
  totals: MealMacros,
  meals: Meal[],
  overrides?: Partial<Record<MicronutrientKey, MicroTargetOverride>> | null,
): NutrientsView {
  const counted = countMeasured(meals);
  const unmeasured = !hasMicros(totals);
  const readings = resolveMicronutrientTargets({}, overrides).map((t) =>
    reading(t, amountOf(totals, t.key as keyof MealMacros)),
  );

  const ceiling = readings.find((r) => r.direction === 'ceiling') ?? null;
  const floors = readings.filter((r) => r.direction === 'floor');
  // Nothing measurable came in: every floor would read 0% and three invented shortfalls with it.
  const aiming = unmeasured
    ? []
    : floors
        .filter((r) => r.short)
        .sort((a, b) => a.pct - b.pct)
        .slice(0, AIMING_MAX);
  const featured = new Set(aiming.map((r) => r.key));

  return { aiming, ceiling, also: floors.filter((r) => !featured.has(r.key)), counted, unmeasured };
}

/**
 * The line under the lists — the whole "floor, not a measurement" contract in one sentence, worded
 * so that missing data reads as a limit of ours rather than a failure of theirs.
 */
export function countedLine(view: NutrientsView): string {
  const { measured, total } = view.counted;
  if (total === 0) return 'Nothing logged yet, so there is nothing to count from.';
  // Never claim every figure is the published one when it is not — an override is exactly the
  // number this person cares most about, and quietly filing it under "published" erases that.
  const anyOverride = [...view.aiming, ...view.also, ...(view.ceiling ? [view.ceiling] : [])].some((r) => r.overridden);
  const source = anyOverride
    ? 'Reference intakes are the published adult figures, except the ones you asked me to use instead; sodium is the only ceiling.'
    : 'Reference intakes are the published adult figures; sodium is the only ceiling.';
  if (measured === 0) {
    return (
      `None of today's ${total} ${total === 1 ? 'item' : 'items'} carry mineral data — what you logged ` +
      `counted its calories, not its minerals. ${source}`
    );
  }
  return (
    `Counted from ${measured} of your ${total} items: a meal typed in words brings its calories but ` +
    `not its minerals, so these read low rather than wrong. ${source}`
  );
}

/** "14 of 18 mg" for a floor, "1,940 / 2,300 mg" for the ceiling — a budget reads as a fraction. */
export function readingText(r: NutrientReading): { value: string; rest: string } {
  return r.direction === 'ceiling'
    ? { value: r.eatenText, rest: `/ ${r.targetText} ${r.unit}` }
    : { value: r.eatenText, rest: `of ${r.targetText} ${r.unit}` };
}

/** What a screen reader should hear — never the label and the number welded into one token. */
export function readingLabel(r: NutrientReading): string {
  const t = readingText(r);
  return r.direction === 'ceiling'
    ? `${r.label}: ${t.value} of a ${r.targetText} ${r.unit} budget`
    : `${r.label}: ${t.value} ${r.unit} of ${r.targetText}`;
}
