/**
 * A described meal's rows in words for the coach — one grammar for both of her food tools, so
 * `preview_meal` and `log_meal` describe the same row the same way (FOOD-LOGGING-COACH-LED.md,
 * build step 3). Where a number came from, what was assumed, what the row waits on, and why it
 * counted nothing are stated as facts beside the number, never hidden in it.
 *
 * These are COACH-facing words, in the third person: the card's own labels (`source_label`,
 * "your saved food", "what you picked last time") speak to the person, and a line that repeated
 * them read "what they picked last time; from what you picked last time". The basis is said once.
 */
import type { Macros } from '@cadence/shared';
import type { DescribedMealItem } from './food-described-rows.ts';

/** A row as the coach hears it: the read's row, plus what the confirm did to it. */
export interface CoachRow extends DescribedMealItem {
  /**
   * Set when the confirm priced a row the read left unlinked (an estimate, a fallback row) from a
   * food the store matched by name — the food's name when known, null when not. The number is
   * then the store's, not the coach's estimate, and the line says so.
   */
  priced_by_name?: string | null;
}

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

/** The card's second-person source labels (food-described-rows.ts `sourceLabel`), for the coach. */
const THIRD_PERSON: Record<string, string> = {
  'your saved food': 'their saved food',
  'what you picked last time': 'what they picked before',
};
const sourceWords = (label: string | undefined): string => (label ? (THIRD_PERSON[label] ?? label) : 'the ledger');

/** Where the row's number came from, said once. */
export function basisWords(item: CoachRow): string {
  if (item.priced_by_name !== undefined) {
    const named = item.priced_by_name ? ` (${item.priced_by_name})` : '';
    return `priced from a food the store matched by name${named}, not the coach's estimate`;
  }
  switch (item.basis) {
    case 'record':
      return `a record the coach picked, priced from ${sourceWords(item.source_label)}`;
    case 'remembered':
      return 'what they picked before, priced from that food';
    case 'estimate':
      return "the coach's own estimate";
    case 'fallback':
      return 'an automatic estimate, the coach not reached';
    case 'none':
      return 'not counted';
    default:
      return item.source_label ? `priced from ${sourceWords(item.source_label)}` : '';
  }
}

/**
 * One row: amount, name, numbers, then in brackets where the number came from, the assumption,
 * the question it waits on, and why it counted nothing — each only when the row carries it.
 */
export function rowWords(item: CoachRow): string {
  const qty = item.qty ? `${item.qty}${item.unit ? ` ${item.unit}` : ''} ` : '';
  const tail = [
    basisWords(item),
    item.assumption ? `assumed: ${item.assumption}` : '',
    item.question ? `waiting on their answer: ${item.question}` : '',
    item.problem ? `why: ${item.problem}` : '',
  ].filter(Boolean);
  return `${qty}${rowName(item)}: ${macroLine(item.est)}${tail.length ? ` (${tail.join('; ')})` : ''}`;
}
