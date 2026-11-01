/**
 * The phrase memory for described meals: the words someone used, and the food and amount the
 * food-check settled them as, written when they confirm and read before the next check — so
 * "Starbucks venti latte" the second time is a saved pick priced by the store, with no model
 * call ("Logged, and learned", FOOD-LOGGING-COACH-LED.md step 6).
 *
 * Only a confirmed row teaches it (a preview walked away from leaves nothing behind), and only
 * a row that names a food: an estimate has no record to remember. Best-effort on both sides —
 * the table is migration 0064, and until it is applied a recall finds nothing and a remember
 * logs a warning; a miss costs one model call, never the meal.
 */
import { recallFoodPhrases, rememberFoodPhrase, type FoodPhraseRow } from '../repos/food-phrases.ts';
import { stripAmount } from './food-candidate-book.ts';

/**
 * The key a phrase is stored under: the amount peeled off, lowercase, accents folded to their
 * base letter (NFD then the combining marks dropped — the metronome lesson: a stripping that
 * eats the first letter is worse than none), punctuation to spaces, spaces collapsed.
 */
export function phraseKey(said: string): string {
  const { q } = stripAmount(said);
  return q
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** The rows a confirm can teach from: a food, the words it was said in, and an amount. */
export interface LearnableItem {
  food_id?: string;
  said?: string;
  qty?: number;
  unit?: string;
}

/** Which of a confirmed meal's rows teach the memory, and what each writes. Pure. */
export function phraseLinksOf(
  items: LearnableItem[],
): Array<{ phrase: string; food_id: string; qty: number; unit: string | null }> {
  const out: Array<{ phrase: string; food_id: string; qty: number; unit: string | null }> = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (!it.food_id || !it.said || !(typeof it.qty === 'number' && it.qty > 0)) continue;
    const phrase = phraseKey(it.said);
    if (!phrase || seen.has(phrase)) continue;
    seen.add(phrase);
    out.push({ phrase, food_id: it.food_id, qty: it.qty, unit: it.unit?.trim() || null });
  }
  return out;
}

/** Teach the memory from a confirmed meal. Never throws. */
export async function learnDescribedMeal(userId: string, items: LearnableItem[]): Promise<void> {
  for (const link of phraseLinksOf(items)) {
    try {
      await rememberFoodPhrase(userId, link);
    } catch (e) {
      console.warn('[food-phrases] remember failed (0064 applied?):', e instanceof Error ? e.message : e);
      return;
    }
  }
}

/** What the memory holds for these phrases. Empty on any failure. */
export async function recallPhrases(userId: string, keys: string[]): Promise<Map<string, FoodPhraseRow>> {
  try {
    return await recallFoodPhrases(userId, keys);
  } catch (e) {
    console.warn('[food-phrases] recall failed (0064 applied?):', e instanceof Error ? e.message : e);
    return new Map();
  }
}
