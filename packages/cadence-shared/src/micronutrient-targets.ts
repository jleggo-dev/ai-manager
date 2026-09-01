import type { MicroTargetOverride, MicronutrientKey } from './types/nutrition.ts';

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
 * ONE THING OVERRIDES THE TABLE, and it is still not the model's opinion: a number this person was
 * given outside the app. "My doctor wants me on 2,000mg of vitamin C a day" is a fact about them,
 * and a coach who kept coaching to 90mg would be ignoring the most authoritative thing in the
 * conversation (owner ruling, 2026-09-01). `resolveMicronutrientTargets` applies those overrides
 * over this table, `sanitizeMicroTargetAmount` holds the safe window they must land in, and
 * `set_micro_target` is the only tool that writes one — with the reason required, because the
 * override's whole claim to authority is where it came from.
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
  key: MicronutrientKey;
  /** What to eat at least, or stay under. */
  amount: number;
  direction: MicroDirection;
  /** How to say it out loud. */
  label: string;
  unit: string;
  /** Why someone would care — the coach's plain-words hook, never a lecture. */
  why: string;
  /** Ordinary foods that carry it, for a line that suggests instead of only reporting. */
  sources: string;
  /**
   * Where `amount` came from. 'reference' is the published table; 'override' means someone was
   * told a different number and the coach recorded it — `set_because` says what they were told.
   */
  origin: 'reference' | 'override';
  set_because?: string;
}

export type BiologicalSex = 'male' | 'female';

interface Row {
  key: MicronutrientKey;
  label: string;
  unit: string;
  direction: MicroDirection;
  why: string;
  sources: string;
  male: number;
  female: number;
  /** Women 51+ need less iron; men 71+ and women 51+ need more calcium. */
  femaleOver50?: number;
  maleOver70?: number;
  /**
   * The window an OVERRIDE must land in — see `sanitizeMicroTargetAmount`. The upper end is the
   * published Tolerable Upper Intake Level where one exists (vitamin C 2,000mg, iron 45mg, zinc
   * 40mg, calcium 2,500mg); where the National Academies set none, it is a sanity bound rather
   * than a safety claim. The lower end stops a target being set so low that a real shortfall
   * would be silenced by it.
   */
  safe: [number, number];
}

const DRI: Row[] = [
  {
    key: 'fiber_g',
    label: 'Fibre',
    unit: 'g',
    direction: 'floor',
    why: 'Keeps digestion steady and helps you feel full for longer.',
    sources: 'beans, oats, berries or a skin-on potato',
    safe: [10, 100],
    male: 38,
    female: 25,
  },
  {
    key: 'sodium_mg',
    label: 'Sodium',
    unit: 'mg',
    direction: 'ceiling',
    why: 'Most of it arrives in packaged food rather than the salt shaker.',
    sources: 'bread, deli meat, sauces and restaurant food carry most of it',
    safe: [1000, 4000],
    male: 2300,
    female: 2300,
  },
  {
    key: 'iron_mg',
    label: 'Iron',
    unit: 'mg',
    direction: 'floor',
    why: 'Low iron shows up as tiredness long before anything else.',
    sources: 'a handful of spinach or lentils',
    safe: [8, 45],
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
    sources: 'pumpkin seeds or chickpeas',
    safe: [8, 40],
    male: 11,
    female: 8,
  },
  {
    key: 'vitamin_c_mg',
    label: 'Vitamin C',
    unit: 'mg',
    direction: 'floor',
    why: 'Also helps you absorb iron from plants — the two travel together.',
    sources: 'peppers, citrus or strawberries',
    safe: [45, 2000],
    male: 90,
    female: 75,
  },
  {
    key: 'calcium_mg',
    label: 'Calcium',
    unit: 'mg',
    direction: 'floor',
    why: 'Bone strength, and it matters most in the years you notice it least.',
    sources: 'yogurt, tinned sardines or a fortified milk',
    safe: [500, 2500],
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
    sources: 'potatoes, beans, bananas or yogurt',
    safe: [1500, 6000],
    male: 3400,
    female: 2600,
  },
  {
    key: 'vitamin_b12_ug',
    label: 'Vitamin B12',
    unit: 'µg',
    direction: 'floor',
    why: 'Comes almost entirely from animal foods — the one to watch on a plant-based diet.',
    sources: 'eggs, dairy, fish, or a fortified cereal on a plant-based diet',
    safe: [2, 1000],
    male: 2.4,
    female: 2.4,
  },
];

/**
 * The reference intakes for this person. Unknown sex or age → the more cautious figure of the
 * two, because a target that is slightly high costs a nudge and one that is too low costs the
 * whole point of tracking it.
 */
/** The fields an intake carries whatever its amount turns out to be. */
function base(r: Row): Omit<MicronutrientTarget, 'amount' | 'origin'> {
  return { key: r.key, direction: r.direction, label: r.label, unit: r.unit, why: r.why, sources: r.sources };
}

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
    return { ...base(r), amount, origin: 'reference' as const };
  });
}

/** Every key that has a reference intake — what a day rollup is worth showing progress against. */
export const MICRONUTRIENT_KEYS = DRI.map((r) => r.key);

/** The window an override for this nutrient must land in, or null for a key with no intake. */
export function microTargetRange(key: MicronutrientKey): [number, number] | null {
  return DRI.find((r) => r.key === key)?.safe ?? null;
}

/**
 * Round and range-check a proposed override; null when it does not survive.
 *
 * Rejects rather than clamps, for the reason `sanitizeTargets` gives about macros: a number
 * silently pulled back into range looks deliberate, and here it would be a dose nobody chose. The
 * upper bound is the published safe upper limit where the National Academies set one — 2,000mg of
 * vitamin C is exactly that limit, so a doctor asking for 2,000 is accepted and 3,000 is not.
 */
export function sanitizeMicroTargetAmount(key: MicronutrientKey, amount: unknown): number | null {
  const range = microTargetRange(key);
  if (!range) return null;
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
  // B12's whole reference intake is 2.4µg, so rounding it to a whole number would erase the
  // difference between a normal target and a supplemented one.
  const rounded = key === 'vitamin_b12_ug' ? Math.round(amount * 10) / 10 : Math.round(amount);
  if (rounded < range[0] || rounded > range[1]) return null;
  return rounded;
}

/**
 * The intakes this person is coached against: the reference table, with any number they were told
 * from OUTSIDE the app standing in for it (owner ruling 2026-09-01 — a doctor asking for 2,000mg
 * of vitamin C a day is a fact about that person, not a proposal for the model to make up).
 *
 * Every override is re-checked on the way out rather than trusted because it was stored. A blob
 * written when the bounds were looser — or edited by any path that skipped the tool — falls back
 * to the published figure instead of being honoured, so the safe window is enforced at read time
 * where it cannot be routed around.
 */
export function resolveMicronutrientTargets(
  opts: { sex?: BiologicalSex | null; age?: number | null } = {},
  overrides?: Partial<Record<MicronutrientKey, MicroTargetOverride>> | null,
): MicronutrientTarget[] {
  const table = micronutrientTargets(opts);
  if (!overrides) return table;
  return table.map((t) => {
    const set = overrides[t.key];
    const amount = set ? sanitizeMicroTargetAmount(t.key, set.amount) : null;
    if (amount === null || !set) return t;
    return { ...t, amount, origin: 'override' as const, set_because: set.why };
  });
}

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
