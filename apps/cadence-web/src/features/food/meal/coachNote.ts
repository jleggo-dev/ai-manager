/**
 * What Cadence is told when her face is tapped from the quick log (owner ruling, 2026-10-28:
 * "hop to the coach chat — with the context that you're logging a meal, which meal, and the
 * coach should also be able to pull recent food history and goals").
 *
 * App-authored, whispered as a note — it renders in nobody's bubble. It names the moment (the
 * slot, the day if not today), says what is in the cart or what was logged so she never asks
 * them to repeat it, and points at the reads she already has: get_food_log for the recent
 * days, get_nutrition for today's totals and targets. Her goals are in her context pack.
 */
import type { MealKind, Macros, MealItem, MealPart } from '@cadence/shared';
import { fmtKcal } from '../bracket/copy.ts';

export interface MealForNote {
  meal: MealKind;
  date: string;
  items: MealItem[];
  parts?: MealPart[];
  total: Macros;
  logged: boolean;
}

/** "eggs on toast, flat white" — brackets by name, loose rows by name, each once. */
export function cartWords(items: MealItem[], parts: MealPart[] = []): string {
  const words: string[] = [];
  const seenPart = new Set<string>();
  for (const it of items) {
    if (it.part) {
      if (seenPart.has(it.part)) continue;
      seenPart.add(it.part);
      const part = parts.find((p) => p.key === it.part);
      words.push((part?.name ?? it.name).toLowerCase());
    } else {
      words.push(it.name.toLowerCase());
    }
  }
  return words.join(', ');
}

export function quickLogCoachNote(m: MealForNote, today: string): string {
  const when = m.date === today ? '' : ` for ${m.date}`;
  const where = `They are in the quick log, ${m.logged ? 'in' : 'logging'} their ${m.meal}${when}, and tapped you from it.`;
  const what =
    m.items.length === 0
      ? `Nothing in it yet.`
      : m.logged
        ? `Logged: ${cartWords(m.items, m.parts)} (${fmtKcal(m.total.kcal)} kcal).`
        : `In the cart so far, not logged yet: ${cartWords(m.items, m.parts)} (about ${fmtKcal(m.total.kcal)} kcal).`;
  return (
    `${where} ${what} Open on THAT meal — a read on it, or help choosing. ` +
    'Their recent eating is on file: get_food_log for the last days, get_nutrition for today’s ' +
    'totals against their targets; their goals are already in your context. Weigh in against ' +
    'those rather than asking them to repeat what the cart already says.'
  );
}
