/**
 * `preview_meal` — the Coach's half of the Food screen's own two-call flow (MP21/MP40,
 * FOOD-ENGINE.md §7 §8).
 *
 * The Food tab turns words into an itemised meal with `POST /nutrition/meals/preview` before
 * anything commits — parse, resolve each item against the ledger, price it, and say what is
 * settled and what is not. This wraps that exact service, `previewMealParse`, so a preview
 * requested from chat is the SAME reading the screen would have produced, not a second, weaker
 * implementation kept alive beside it.
 *
 * SHE SELECTS, SHE DOES NOT SUMMARISE (owner ruling, FOOD-ENGINE.md §8, correcting an earlier
 * draft of this plan that asked her to hand over pre-structured items instead). `text` is the
 * person's own words about the food, plus whatever only she knows from the conversation — which
 * chilli, which meal, that "the usual" means what it usually means for them. Not a précis of what
 * they said — their words, selected. The deterministic rungs run from there, and the model that
 * guesses at whatever is still unresolved is the LAST rung this hits, never the first.
 *
 * WHAT THIS DOES NOT DO: log anything. `previewMealParse`'s own contract is to pin nothing, so a
 * preview she walks away from — or calls three times while narrowing down the words — leaves no
 * trace and costs nothing beyond the read itself. `log_meal` runs this same read and logs what it
 * shows (food-log-described.ts, FOOD-LOGGING-COACH-LED.md step 3), so the two never disagree.
 */
import { macroLine, rowName, rowWords } from '../food-described-render.ts';
import type { DescribedMealItem } from '../food-described-rows.ts';
import { previewMealParse } from '../nutrition.ts';
import { toolFaultText } from '../tool-response.ts';
import type { RetrievalFunction } from './types.ts';

const MEAL_KINDS = ['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'other'] as const;
type MealKindParam = (typeof MEAL_KINDS)[number];
const isMealKindParam = (v: unknown): v is MealKindParam => (MEAL_KINDS as readonly string[]).includes(String(v));

type PreviewMealResult = Awaited<ReturnType<typeof previewMealParse>>;
type PreviewItem = DescribedMealItem;

/**
 * An item counts as PRICED exactly when `priceParsedMeal` decided it did — `est` carries at least
 * one number. Mirrors food-pricing.ts's own `everyItemCounted` check rather than re-deriving a
 * different answer, because `previewMealParse` hands back the priced `items` but not the
 * `fully_priced` boolean itself (it is dropped between `priceParsedMeal` and this call's return).
 */
const isPriced = (item: PreviewItem): boolean => !!item.est && Object.keys(item.est).length > 0;

/**
 * The coach-led read says where each number came from, what it assumed, what it would ask, and
 * why a row has no number (FOOD-LOGGING-COACH-LED.md) — facts for her, never hidden in the number.
 * The same words `log_meal` uses for a row (food-described-render.ts), so both tools read alike.
 */
const itemLine = (item: PreviewItem): string => `- ${rowWords(item)}`;

/** For an unresolved item, what she should do about it — named per item, never a generic hint. */
function unresolvedLine(item: PreviewItem): string {
  const named = rowName(item);
  if (item.brand) {
    return (
      `- ${named}: named a brand nothing on file matched. research_food can look it up — pass ` +
      `{"name": "${item.name}", "brand": "${item.brand}"} — if the exact numbers are worth the wait.`
    );
  }
  return `- ${named}: nothing matched closely enough to price. Ask them for more detail (a brand, an amount), or point them at the Food screen to pick it themselves.`;
}

export const PREVIEW_MEAL: RetrievalFunction = {
  name: 'preview_meal',
  mutates: 'none',
  description:
    'Reads described food into an itemised meal WITHOUT logging it — the read the Food screen runs before a confirm. Use when unsure the words alone will price cleanly, or to answer a "how many calories" question about food not yet eaten; for the plain case ("had a banana") call log_meal instead. Pass {"text": "two eggs, toast and coffee"}; add {"meal": "breakfast"} (or lunch/dinner/snack/drink/other) when known — omit and it takes the slot the words name, else other. Writes nothing; call it as often as you like.',
  domains: ['nutrition', 'foods'],

  async run(userId, params) {
    const text = typeof params?.text === 'string' ? params.text.trim() : '';
    if (!text) return null;
    const meal = isMealKindParam(params?.meal) ? params.meal : undefined;
    return previewMealParse(userId, text, meal);
  },

  render(result) {
    if (result === undefined) return toolFaultText('That reading');
    if (result === null) return 'Preview a meal: pass text (their own words about what they ate or are considering).';
    const r = result as PreviewMealResult;
    if (!r.items.length) {
      return `Nothing readable as food in "${r.raw_text}". Ask what they actually had, or the amount, before logging anything.`;
    }

    // A row with an open question carries no number on purpose: the question is the answer it
    // waits for, and it is counted only once the person gives it.
    const asked = r.items.filter((i) => !!i.question);
    const unpriced = r.items.filter((i) => !isPriced(i) && !i.question);
    const fullyPriced = unpriced.length === 0 && asked.length === 0;
    const priced = r.items.length - unpriced.length - asked.length;
    const total = macroLine(r.macros);

    const head = fullyPriced
      ? `Fully priced (${r.meal}): every item has numbers, total ${total}.`
      : `Partly priced (${r.meal}): ${priced}/${r.items.length} items have numbers` +
        (asked.length ? `, ${asked.length} waiting on their answer` : '') +
        `, total so far ${total}.`;
    const reached =
      r.coach?.reached === false
        ? 'The food-check model could not be reached, so these are the old automatic estimates, not a checked read.'
        : '';

    // What is true about logging it (since 2026-11-01): log_meal runs this same read and logs the
    // rows it shows; a row waiting on their answer, or one that could not be counted, is handed
    // back, not logged — log_meal holds those back itself, so no steer about it belongs here.
    const logging =
      "Note: log_meal runs this same read and logs what it shows — a row waiting on their answer, or one that could not be counted, is handed back, not logged. The Food screen's confirm logs exactly what is shown here.";
    // Parts the split did not read, said as facts: a dropped part must never read as a meal that
    // never had it (tool-response.ts rule 2).
    const notRead = r.coach?.not_read?.length ? ['Not read:', ...r.coach.not_read.map((l) => `- ${l}`)] : [];
    const waiting = asked.length
      ? [
          'Waiting on their answer:',
          ...asked.map((i) => `- ${rowName(i)}: ${i.question}`),
          'Ask them, then preview again with the answer in the text.',
        ]
      : [];
    const tail = fullyPriced
      ? [`Everything here is settled. ${logging}`]
      : [...waiting, ...(unpriced.length ? ['Unresolved, by name:', ...unpriced.map(unresolvedLine)] : []), logging];

    return [head, reached, ...r.items.map(itemLine), ...notRead, ...tail].filter(Boolean).join('\n');
  },

  rows(result) {
    return result ? (result as PreviewMealResult).items.length : 0;
  },
};
