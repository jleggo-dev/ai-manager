/**
 * A described meal's rows in words for the coach — one grammar for both of her food tools, so
 * `preview_meal` and `log_meal` describe the same row the same way (FOOD-LOGGING-COACH-LED.md,
 * build step 3). Where a number came from, what was assumed, what the row waits on, and why it
 * counted nothing are stated as facts beside the number, never hidden in it.
 */
import type { DescribedBasis, Macros } from '@cadence/shared';
import type { DescribedMealItem } from './food-described-rows.ts';

/** Where a row's numbers came from, in words she can repeat. */
export const BASIS_WORDS: Record<DescribedBasis, string> = {
  record: 'a record the coach picked',
  remembered: 'what they picked last time',
  estimate: "the coach's own estimate",
  fallback: 'an automatic estimate, the coach not reached',
  none: 'not counted',
};

/** "250 kcal · 12g protein · 30g carbs · 8g fat", or "not priced yet" when there is no number. */
export function macroLine(est: Macros | null | undefined): string {
  if (!est) return 'not priced yet';
  const parts: string[] = [];
  if (typeof est.kcal === 'number') parts.push(`${Math.round(est.kcal)} kcal`);
  if (typeof est.protein_g === 'number') parts.push(`${Math.round(est.protein_g)}g protein`);
  if (typeof est.carbs_g === 'number') parts.push(`${Math.round(est.carbs_g)}g carbs`);
  if (typeof est.fat_g === 'number') parts.push(`${Math.round(est.fat_g)}g fat`);
  return parts.length ? parts.join(' · ') : 'not priced yet';
}

/** The row's name as the person would say it: the brand first, when there is one. */
export const rowName = (item: Pick<DescribedMealItem, 'brand' | 'name'>): string =>
  [item.brand, item.name].filter(Boolean).join(' ');

/**
 * One row: amount, name, numbers, then in brackets where the numbers came from, the assumption,
 * the question it waits on, and why it counted nothing — each only when the row carries it.
 */
export function rowWords(item: DescribedMealItem): string {
  const qty = item.qty ? `${item.qty}${item.unit ? ` ${item.unit}` : ''} ` : '';
  const tail = [
    item.basis ? BASIS_WORDS[item.basis] : '',
    item.source_label ? `from ${item.source_label}` : '',
    item.assumption ? `assumed: ${item.assumption}` : '',
    item.question ? `waiting on their answer: ${item.question}` : '',
    item.problem ? `why: ${item.problem}` : '',
  ].filter(Boolean);
  return `${qty}${rowName(item)}: ${macroLine(item.est)}${tail.length ? ` (${tail.join('; ')})` : ''}`;
}
