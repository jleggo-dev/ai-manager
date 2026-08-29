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
 * trace and costs nothing beyond the parse itself.
 */
import type { Macros, NutritionLog } from '@cadence/shared';
import { previewMealParse } from '../nutrition.ts';
import { toolFaultText } from '../tool-response.ts';
import type { RetrievalFunction } from './types.ts';

const MEAL_KINDS = ['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'other'] as const;
type MealKindParam = (typeof MEAL_KINDS)[number];
const isMealKindParam = (v: unknown): v is MealKindParam => (MEAL_KINDS as readonly string[]).includes(String(v));

type PreviewMealResult = Awaited<ReturnType<typeof previewMealParse>>;
type PreviewItem = NutritionLog['items'][number];

/**
 * An item counts as PRICED exactly when `priceParsedMeal` decided it did — `est` carries at least
 * one number. Mirrors food-pricing.ts's own `everyItemCounted` check rather than re-deriving a
 * different answer, because `previewMealParse` hands back the priced `items` but not the
 * `fully_priced` boolean itself (it is dropped between `priceParsedMeal` and this call's return).
 */
const isPriced = (item: PreviewItem): boolean => !!item.est && Object.keys(item.est).length > 0;

function macroLine(est: Macros | null | undefined): string {
  if (!est) return 'not priced yet';
  const parts: string[] = [];
  if (typeof est.kcal === 'number') parts.push(`${Math.round(est.kcal)} kcal`);
  if (typeof est.protein_g === 'number') parts.push(`${Math.round(est.protein_g)}g protein`);
  if (typeof est.carbs_g === 'number') parts.push(`${Math.round(est.carbs_g)}g carbs`);
  if (typeof est.fat_g === 'number') parts.push(`${Math.round(est.fat_g)}g fat`);
  return parts.length ? parts.join(' · ') : 'not priced yet';
}

function itemLine(item: PreviewItem): string {
  const qty = item.qty ? `${item.qty}${item.unit ? ` ${item.unit}` : ''} ` : '';
  const name = [item.brand, item.name].filter(Boolean).join(' ');
  return `- ${qty}${name}: ${macroLine(item.est)}`;
}

/** For an unresolved item, what she should do about it — named per item, never a generic hint. */
function unresolvedLine(item: PreviewItem): string {
  const named = [item.brand, item.name].filter(Boolean).join(' ');
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
  description:
    'Reads food someone described into an itemised meal WITHOUT logging it — the parse-and-price the Food screen runs before a confirm. Use when unsure the words alone will price cleanly, or to answer a "how many calories" question about food not yet eaten; for the plain case ("had a banana") call log_meal instead, no preview needed. Pass {"text": "two eggs, toast and coffee"}; add {"meal": "breakfast"} (or lunch/dinner/snack/drink/other) when known — omit and it guesses. Writes nothing; call it as often as you like.',
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

    const unpriced = r.items.filter((i) => !isPriced(i));
    const fullyPriced = unpriced.length === 0;
    const total = macroLine(r.macros);

    const head = fullyPriced
      ? `Fully priced (${r.meal}): every item has numbers, total ${total}.`
      : `Partly priced (${r.meal}): ${r.items.length - unpriced.length}/${r.items.length} items have numbers, total so far ${total}.`;

    const tail = fullyPriced
      ? 'Everything here is settled — log_meal with this same text prices it the same way.'
      : [
          'Unresolved, by name:',
          ...unpriced.map(unresolvedLine),
          'Do not log_meal this and call it done while items are unresolved — say what is missing, or log once you have enough to price it.',
        ].join('\n');

    return [head, ...r.items.map(itemLine), tail].join('\n');
  },

  rows(result) {
    return result ? (result as PreviewMealResult).items.length : 0;
  },
};
