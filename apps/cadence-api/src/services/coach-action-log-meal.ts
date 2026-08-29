import type { MealKind } from '@cadence/shared';
import { logMeal } from './nutrition.ts';
import type { CoachActionTool } from './coach-action-types.ts';

const MEAL_KINDS: readonly MealKind[] = ['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'other'];
const isMealKind = (v: unknown): v is MealKind => (MEAL_KINDS as readonly string[]).includes(String(v));

/**
 * `log_meal` — the Coach's half of the Food screen's OTHER call (MP21/MP40, FOOD-ENGINE.md §7 §8).
 *
 * The Food tab writes a meal one of two ways: preview-then-confirm, or a plain quick-add that
 * parses and prices in a single call — `POST /nutrition/meals` given just `text`. This is that
 * second, simpler call, because most of what gets said in a conversation IS that simple ("had a
 * protein shake") and does not deserve a preview round-trip first. `preview_meal` sits beside this
 * for when it is not — an unfamiliar product, a "how many calories" question, anything she is not
 * confident will price cleanly from the words alone.
 *
 * SHE SELECTS, SHE DOES NOT SUMMARISE (FOOD-ENGINE.md §8). `text` is the person's own words, plus
 * whatever only she knows from the conversation ("the usual" → what that usually means for them,
 * which chilli). The ledger prices it; she never invents a number herself.
 *
 * LOGGING IS BOOKKEEPING, NOT COACHING (FOOD-ENGINE.md §7). She calls this and moves on — one
 * line, not a review of the meal. Her opinion belongs at a check-in or when asked, never here.
 * Restraint matters more than recall: the deleted `FOOD_CONFIRM_CONTEXT`/`log_food` regex used to
 * be crude protection against logging something the person only mentioned in passing or was still
 * considering. That protection is gone; the eval's restraint cases (`eval-tool-selection-cases.ts`)
 * are what stand in for it now, and this description carries the same gate in words.
 */
export const LOG_MEAL: CoachActionTool = {
  name: 'log_meal',
  description:
    'Log a meal exactly as the person described eating it — pass their own words and it parses, prices from their saved foods and the shared database, and writes one row. Takes effect immediately. Use it once they have actually eaten or drunk something — never for something they are only considering, asking the calories of, or might cook later; call preview_meal first instead if you are not confident the words alone will price cleanly. Pass {"text": "a protein shake and a banana"}; add {"meal": "breakfast"} (or lunch/dinner/snack/drink/other) when said, omit and the parse guesses; add {"date": "2026-08-27"} only when it was not today, omit it for today — "forgot to log lunch" still means today.',
  parameters: {
    properties: {
      text: {
        type: 'string',
        description: 'What they said about the food, in their own words — never your summary of it.',
      },
      meal: {
        type: 'string',
        enum: [...MEAL_KINDS],
        description: 'Which meal, when they said or clearly implied one. Omit and the parse guesses from context.',
      },
      date: {
        type: 'string',
        description: 'YYYY-MM-DD, only when this was not today. Omit for today.',
      },
    },
    required: ['text'],
  },
  async run(userId, params) {
    const text = String(params.text ?? '').trim();
    if (!text) return 'No food was named, so nothing was logged. Ask what they actually had.';
    const meal = isMealKind(params.meal) ? params.meal : undefined;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(params.date ?? '')) ? String(params.date) : undefined;

    let row: Awaited<ReturnType<typeof logMeal>>;
    try {
      row = await logMeal(userId, { text, meal, date });
    } catch (e) {
      console.error('[log_meal] logMeal failed:', e);
      return 'That could not be logged just now — tell them plainly and offer to try again, or point them at the Food screen.';
    }

    const kcal = typeof row.macros?.kcal === 'number' ? `${Math.round(row.macros.kcal)} kcal` : null;
    const items = row.items.map((i) => [i.brand, i.name].filter(Boolean).join(' ')).join(', ') || text;

    if (row.provisional) {
      return [
        `Logged, but PROVISIONAL: "${items}" is on their file for ${row.date} (${row.meal}), but ` +
          `${kcal ? `only part of it priced so far (${kcal})` : 'nothing priced yet'} — it will not count toward ` +
          "today's totals until it is settled.",
        'Say honestly that you logged what they said but could not price all of it. Ask for more detail (an amount, a brand) if that would help, or say the Food screen can fill in the rest. Do not claim it is fully counted.',
      ].join('\n');
    }
    return [
      `Logged: "${items}" for ${row.date} (${row.meal})${kcal ? `, ${kcal}` : ''}.`,
      'Say ONE short line confirming it and move on — this is bookkeeping, not something to review or comment on unless they ask.',
    ].join('\n');
  },
};
