import type { Macros } from './types/nutrition.ts';

/**
 * Reference daily intakes for the micronutrients Cadence can actually measure.
 *
 * These are the published Dietary Reference Intakes (US National Academies) for adults — the same
 * numbers a nutrition label's "% Daily Value" is built from. They are a LOOKUP, never a model
 * output: a micronutrient target is a fact about human biology, not something to ask an LLM for,
 * and the coach proposing "you need 18mg of iron" is only trustworthy if that number came from a
 * table. Macro targets are the opposite — they depend on this person's body, goal and observed
 * rate, and stay with the adaptive loop in nutrition-baseline.
 *
 * Two directions, and conflating them would be a real harm:
 *  - `floor` — eat AT LEAST this. Falling short is the thing to notice.
 *  - `ceiling` — stay UNDER this. Sodium is the one here, and showing it as a goal to reach would
 *    be actively bad advice.
 *
 * Deliberately narrow. Only nutrients with real data behind them (USDA / labels / Open Food Facts)
 * appear, because a target for something we cannot measure is a number that can only ever nag.
 */

export type MicroDirection = 'floor' | 'ceiling';

export interface MicronutrientTarget {
  key: keyof Macros;
  /** What to eat at least, or stay under. */
  amount: number;
  direction: MicroDirection;
  /** How to say it out loud. */
  label: string;
  unit: string;
  /** Why someone would care — the coach's plain-words hook, never a lecture. */
  why: string;
}

export type BiologicalSex = 'male' | 'female';

interface Row {
  key: keyof Macros;
  label: string;
  unit: string;
  direction: MicroDirection;
  why: string;
  male: number;
  female: number;
  /** Women 51+ need less iron; men 71+ and women 51+ need more calcium. */
  femaleOver50?: number;
  maleOver70?: number;
}

const DRI: Row[] = [
  {
    key: 'fiber_g',
    label: 'Fibre',
    unit: 'g',
    direction: 'floor',
    why: 'Keeps digestion steady and helps you feel full for longer.',
    male: 38,
    female: 25,
  },
  {
    key: 'sodium_mg',
    label: 'Sodium',
    unit: 'mg',
    direction: 'ceiling',
    why: 'Most of it arrives in packaged food rather than the salt shaker.',
    male: 2300,
    female: 2300,
  },
  {
    key: 'iron_mg',
    label: 'Iron',
    unit: 'mg',
    direction: 'floor',
    why: 'Low iron shows up as tiredness long before anything else.',
    male: 8,
    female: 18,
    femaleOver50: 8,
  },
  {
    key: 'zinc_mg',
    label: 'Zinc',
    unit: 'mg',
    direction: 'floor',
    why: 'Immune function and recovery lean on it.',
    male: 11,
    female: 8,
  },
  {
    key: 'vitamin_c_mg',
    label: 'Vitamin C',
    unit: 'mg',
    direction: 'floor',
    why: 'Also helps you absorb iron from plants — the two travel together.',
    male: 90,
    female: 75,
  },
  {
    key: 'calcium_mg',
    label: 'Calcium',
    unit: 'mg',
    direction: 'floor',
    why: 'Bone strength, and it matters most in the years you notice it least.',
    male: 1000,
    female: 1000,
    femaleOver50: 1200,
    maleOver70: 1200,
  },
  {
    key: 'potassium_mg',
    label: 'Potassium',
    unit: 'mg',
    direction: 'floor',
    why: 'Balances sodium; most people get well under this.',
    male: 3400,
    female: 2600,
  },
  {
    key: 'vitamin_b12_ug',
    label: 'Vitamin B12',
    unit: 'µg',
    direction: 'floor',
    why: 'Comes almost entirely from animal foods — the one to watch on a plant-based diet.',
    male: 2.4,
    female: 2.4,
  },
];

/**
 * The reference intakes for this person. Unknown sex or age → the more cautious figure of the
 * two, because a target that is slightly high costs a nudge and one that is too low costs the
 * whole point of tracking it.
 */
export function micronutrientTargets(
  opts: { sex?: BiologicalSex | null; age?: number | null } = {},
): MicronutrientTarget[] {
  const { sex, age } = opts;
  return DRI.map((r) => {
    let amount: number;
    if (sex === 'male') {
      amount = typeof age === 'number' && age > 70 && r.maleOver70 != null ? r.maleOver70 : r.male;
    } else if (sex === 'female') {
      amount = typeof age === 'number' && age > 50 && r.femaleOver50 != null ? r.femaleOver50 : r.female;
    } else {
      // Unknown: floors take the higher requirement, ceilings the lower limit.
      const candidates = [r.male, r.female, r.femaleOver50, r.maleOver70].filter((n): n is number => n != null);
      amount = r.direction === 'floor' ? Math.max(...candidates) : Math.min(...candidates);
    }
    return { key: r.key, amount, direction: r.direction, label: r.label, unit: r.unit, why: r.why };
  });
}

/** Every key that has a reference intake — what a day rollup is worth showing progress against. */
export const MICRONUTRIENT_KEYS = DRI.map((r) => r.key);

/**
 * How a day is doing against one reference intake. `pct` is capped for display at 999 so a wild
 * outlier cannot blow up a bar, and `short` says whether to say anything at all — a floor that is
 * met and a ceiling that is respected both deserve silence rather than a green tick, per BRAND:
 * count what happened, never what broke.
 */
export function microStatus(
  target: MicronutrientTarget,
  eaten: number | undefined,
): { pct: number; short: boolean; over: boolean } {
  const got = typeof eaten === 'number' && Number.isFinite(eaten) ? eaten : 0;
  const pct = target.amount > 0 ? Math.min(999, Math.round((got / target.amount) * 100)) : 0;
  return {
    pct,
    short: target.direction === 'floor' && pct < 100,
    over: target.direction === 'ceiling' && pct > 100,
  };
}
