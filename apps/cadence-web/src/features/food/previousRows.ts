import { PREVIOUS_ROW_MAX_CHARS, PREVIOUS_ROWS_MAX } from '@cadence/shared';
import type { MealPreview } from '../../lib/api.ts';
import { amountWords } from './meal/amountWords.ts';

/**
 * The card's rows as the lines a correction carries back ("Red Robin Guinness (Can), 1 serving"),
 * so the re-read knows what it is correcting — within the wire's own caps, so nothing the card
 * shows is refused on the way back. A row still waiting on her question says so instead of an
 * amount it does not have.
 */
export function previousRows(items: MealPreview['items']): string[] {
  return items.slice(0, PREVIOUS_ROWS_MAX).map((r) => {
    const name = r.brand ? `${r.brand} ${r.name}` : r.name;
    const amount = r.question ? `waiting on: ${r.question}` : amountWords(r);
    return `${name}, ${amount}`.slice(0, PREVIOUS_ROW_MAX_CHARS);
  });
}
