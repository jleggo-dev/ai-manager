import { isCalendarDate, type MealKind } from '@cadence/shared';
import { defineAction, type CoachActionTool } from './coach-action-types.ts';
import { macroLine, questionWords, rowName, rowWords } from './food-described-render.ts';
import type { DescribedMealItem } from './food-described-rows.ts';
import { DescribedMealRejected, logDescribedMeal, type DescribedMealLog } from './food-log-described.ts';
import { toolActionFaultText, toolChangeText, toolNothingChangedText } from './tool-response.ts';

const MEAL_KINDS: readonly MealKind[] = ['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'other'];
const isMealKind = (v: unknown): v is MealKind => (MEAL_KINDS as readonly string[]).includes(String(v));

/** A full stop only where the words do not already end one — a question keeps its mark. */
const sentence = (s: string): string => (/[.!?]$/.test(s) ? s : `${s}.`);

/** An open row, in words: what it waits on, or why it counted nothing. A fragment, not an answer. */
function openWords(row: DescribedMealItem): string {
  const who = `"${rowName(row)}"`;
  return row.question
    ? `${who} waits on their answer: ${questionWords(row)}`
    : `${who} could not be counted: ${row.problem ?? 'no record fits and no estimate was given'}`;
}

/** What she does about the open rows — one line per kind present, after the facts. */
function openNext(open: DescribedMealItem[], loggedSome: boolean): string[] {
  const next: string[] = [];
  if (open.some((r) => r.question)) {
    next.push(
      'Ask them, then call log_meal again with that part alone — their words plus the answer, as one text' +
        (loggedSome ? '; the rest of the meal is already on their file.' : '.'),
    );
  }
  if (open.some((r) => !r.question)) {
    next.push(
      'For a part that could not be counted, ask for more detail (a brand, an amount), or point them at the Food screen to pick it themselves.',
    );
  }
  return next;
}

const NOT_REACHED =
  'The food-check model could not be reached, so these numbers are the old automatic estimates, not a checked read — say so if it matters to them.';

/** The three shapes, from what the read and the write actually did. */
function answer(out: DescribedMealLog, text: string): string {
  const { preview, open, row, written } = out;
  // Parts the split did not read are facts about this call, whatever else it did.
  const notRead = preview.coach.not_read.map(sentence);
  if (!preview.items.length) {
    return toolNothingChangedText(`nothing readable as food in "${text}", so nothing was logged.`, [
      'Ask what they actually had, or the amount, before logging anything.',
    ]);
  }
  if (!row) {
    return toolNothingChangedText(sentence(`nothing was logged — ${open.map(openWords).join('; ')}`), [
      ...notRead,
      ...openNext(open, false),
    ]);
  }

  const where = `${row.date} (${row.meal})`;
  const unchanged = [...open.map((r) => `${openWords(r)} — not logged.`), ...notRead];
  const after = [...openNext(open, true), ...(preview.coach.reached ? [] : [NOT_REACHED])];

  if (row.provisional) {
    const kcal = typeof row.macros?.kcal === 'number' ? `${Math.round(row.macros.kcal)} kcal` : null;
    return toolChangeText({
      changed: [
        `Logged, but PROVISIONAL: "${written.map(rowName).join(', ') || text}" is on their file for ${where}, but ` +
          `${kcal ? `only part of it priced so far (${kcal})` : 'nothing priced yet'} — it will not count toward ` +
          "today's totals until it is settled.",
      ],
      unchanged,
      next: [
        'Say honestly that you logged what they said but could not price all of it. Ask for more detail (an amount, a brand) if that would help, or say the Food screen can fill in the rest. Do not claim it is fully counted.',
        ...after,
      ],
    });
  }

  const lines = written.map((r) => `Logged for ${where}: ${rowWords(r)}.`);
  const total = written.length > 1 ? [`The meal's total is ${macroLine(row.macros)}.`] : [];
  return toolChangeText({ changed: [lines[0]!, ...lines.slice(1), ...total], unchanged, next: after });
}

/**
 * `log_meal` — the Coach's write for a described meal (MP21/MP40, FOOD-ENGINE.md §7 §8), coach-led
 * since 2026-11-01 (docs/cadence/FOOD-LOGGING-COACH-LED.md, build step 3).
 *
 * It runs the SAME read as `preview_meal` and the meal screen — the phrase memory, one fan-out per
 * part, one call to the food-check model, the store pricing (food-log-described.ts) — and logs
 * the settled rows through the card's own confirm path, so what she logs is what she previewed.
 * `preview_meal` sits beside this for when she wants to see the read before committing — an
 * unfamiliar product, a "how many calories" question, food not yet eaten.
 *
 * A row the read left open is NOT logged: its question (or why it could not be counted) comes
 * back here as a fact, and she asks the person in conversation, then calls again with the
 * answered words. Never a tentative pick. The other rows of the meal are logged meanwhile.
 *
 * SHE SELECTS, SHE DOES NOT SUMMARISE (FOOD-ENGINE.md §8). `text` is the person's own words, plus
 * whatever only she knows from the conversation ("the usual" → what that usually means for them,
 * which chilli). The store prices it; she never invents a number herself.
 *
 * LOGGING IS BOOKKEEPING, NOT COACHING (FOOD-ENGINE.md §7). She calls this and moves on — one
 * line, not a review of the meal. Her opinion belongs at a check-in or when asked, never here.
 * Restraint matters more than recall: the deleted `FOOD_CONFIRM_CONTEXT`/`log_food` regex used to
 * be crude protection against logging something the person only mentioned in passing or was still
 * considering. That protection is gone; the eval's restraint cases (`eval-tool-selection-cases.ts`)
 * are what stand in for it now, and this description carries the same gate in words.
 */
export const LOG_MEAL: CoachActionTool = defineAction({
  name: 'log_meal',
  mutates: 'immediate',
  description:
    'Log a meal as the person described eating it — pass their own words; it reads them as preview_meal does (a record picked per part, priced from saved foods and the shared database) and writes one row. {gate}. Use it once they have eaten or drunk something — never for food they are only considering, asking the calories of, or might cook later. A part needing an answer first (which milk, what size) is not logged: its question comes back — ask, then call again with that part and the answer. Pass {"text": "a protein shake and a banana"}; add {"meal": "breakfast"} (or lunch/dinner/snack/drink/other) when known — omit and it takes the slot the words name ("for lunch"), else other; add {"date": "2026-08-27"} only when it was not today — "forgot to log lunch" still means today.',
  parameters: {
    properties: {
      text: {
        type: 'string',
        description: 'What they said about the food, in their own words — never your summary of it.',
      },
      meal: {
        type: 'string',
        enum: [...MEAL_KINDS],
        description:
          'Which meal, when they said or clearly implied one. Omit and it takes the slot the words name ("for lunch"), else other.',
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
    if (!text)
      return toolNothingChangedText('no food was named, so nothing was logged.', ['Ask what they actually had.']);
    const meal = isMealKind(params.meal) ? params.meal : undefined;
    const date = isCalendarDate(params.date) ? params.date : undefined;

    let out: DescribedMealLog;
    try {
      out = await logDescribedMeal(userId, { text, meal, date });
    } catch (e) {
      console.error('[log_meal] logDescribedMeal failed:', e);
      // A row past the card's caps is said with its rule, so she can fix the words; anything else
      // is a fault with nothing claimed either way.
      const why = e instanceof DescribedMealRejected ? ` (${e.message})` : '';
      return toolActionFaultText(
        `That could not be logged${why}`,
        'tell them plainly and offer to try again, or point them at the Food screen.',
      );
    }
    return answer(out, text);
  },
});
