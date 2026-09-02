/**
 * The sweep's shared words (canvas "Cadence Meal Logging" frames S3/S4; MEAL-LOGGING.md "The
 * Sunday sweep"). Copy is verbatim from the canvas except where a count must come from the data —
 * counts read as words through bracket/copy.ts so every food surface says "five", never "5".
 *
 * Two canvas phrases are adapted rather than copied, both because their example data leaked into
 * the words: "read as a bowl" names the actual proposal instead ("read as Chia bowl"), and
 * "Two of the five had an extra thing in them" becomes a conditional — the tidy response carries
 * no extras count, and inventing one would break the numbers-honesty rule.
 */
import type { FoodSweepProposal, MealKind } from '@cadence/shared';
import { fmtKcal, numberWord, numberWordCap } from '../bracket/copy.ts';

/** A commit-response tidy entry joined back to its proposal — the S4 offer's unit. */
export interface TidyableProposal {
  proposal: FoodSweepProposal;
  logCount: number;
}

/** S3's one-line notice — the entry card and the sheet's coach bubble say it identically. */
export function noticeLine(count: number): string {
  return count === 1
    ? 'One thing kept turning up this week. Want it as one row you can tap?'
    : `${numberWordCap(count)} things kept turning up this week. Want any of them as one row you can tap?`;
}

/** The save subtitle under each proposal: yield 1 saves as a meal, yield N as a recipe. */
export function saveLine(p: FoodSweepProposal): string {
  return p.yield_servings > 1
    ? `Saves as a recipe · ${p.yield_servings} servings · ${fmtKcal(p.macros_per_serving.kcal)} per serving`
    : `Saves as a meal · ${fmtKcal(p.macros_per_serving.kcal)} kcal · named from your own words`;
}

const SLOT_PLURAL: Partial<Record<MealKind, string>> = {
  breakfast: 'breakfasts',
  lunch: 'lunches',
  dinner: 'dinners',
  snack: 'snacks',
  drink: 'drinks',
};

/** "breakfasts" while every tidyable proposal shares a slot; plain "meals" once they differ. */
export function slotPlural(tidyable: TidyableProposal[]): string {
  const slots = new Set(tidyable.map((t) => t.proposal.slot));
  const only = slots.size === 1 ? [...slots][0] : undefined;
  return (only && SLOT_PLURAL[only]) ?? 'meals';
}

/** How many logged meals the tidy would re-read, across every offered proposal. */
export function tidyTotal(tidyable: TidyableProposal[]): number {
  return tidyable.reduce((n, t) => n + t.logCount, 0);
}

/** S4's offer bubble — counts and the name from the data, the rest from the canvas. */
export function tidyBubble(tidyable: TidyableProposal[]): string {
  const first = tidyable[0];
  if (!first) return '';
  return (
    `Want me to tidy the week behind you too? ${numberWordCap(tidyTotal(tidyable))} ` +
    `${slotPlural(tidyable)} would read as ${first.proposal.name} instead of ` +
    `${numberWord(first.proposal.members.length)} rows each. Same numbers.`
  );
}

/** The equality line under the diagram — the same figure twice, both from the data. */
export function numbersLine(tidyable: TidyableProposal[]): string {
  const first = tidyable[0];
  if (!first) return '';
  const k = fmtKcal(first.proposal.macros_per_serving.kcal);
  return `${k} kcal before, ${k} kcal after — on all ${numberWord(tidyTotal(tidyable))} days. Only the reading changes.`;
}

/** The primary door of S4, counts from the data ("Tidy the five breakfasts"). */
export function tidyButtonLabel(tidyable: TidyableProposal[]): string {
  return `Tidy the ${numberWord(tidyTotal(tidyable))} ${slotPlural(tidyable)}`;
}

/** Count-honest footnote — never a claim about how many days actually held an extra. */
export const EXTRAS_FOOTNOTE = 'Any that had an extra thing in them keep their extra, loose, outside the bracket.';

/** S3's footer, verbatim — the whole card's promise in one line. */
export const S3_FOOTER = "Nothing's saved until you say so, and none of this touches what you already logged.";
