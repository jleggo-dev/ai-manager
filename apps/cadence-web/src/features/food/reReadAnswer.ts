import { ANSWER_MAX_CHARS, ASKED_ABOUT_MAX_CHARS } from '@cadence/shared';
import { previewMealAnswer, type MealKind, type MealPreview } from '../../lib/api.ts';

/**
 * How many times a row may come back as a question before the card stops offering buttons and
 * falls back to the amount chips, saying she could not settle it (MealAskedRow).
 */
export const REASKS_MAX = 2;

/** What a host's answer step says happened, so the buttons can say it in plain words. */
export type AnswerResult =
  /** The priced row(s) took the asked row's place. */
  | 'replaced'
  /** The server refused the words as written (a 400: too long, or blank) — a different answer is needed. */
  | 'rejected'
  /** The re-read could not be made or came back with nothing — the same answer can be tried again. */
  | 'failed';

export type ReReadOutcome =
  { ok: true; preview: MealPreview } | { ok: false; reason: Exclude<AnswerResult, 'replaced'> };

/**
 * The re-read behind a tapped choice or a typed answer (MealQuestionChoices): the part's words
 * and the answer go to the server as one part through the same read, and the rows for that part
 * come back priced. One helper for every host — the confirm card's hook and the quick-log sheet —
 * so they send the same thing, cut to the same caps the server holds. Never throws: a refusal
 * (400) and a failure are told apart, because one wants different words and the other another go.
 */
export async function reReadAnswer(
  row: { name: string; asked_about?: string },
  answer: string,
  chosen: boolean,
  meal?: MealKind,
): Promise<ReReadOutcome> {
  const text = answer.trim().slice(0, ANSWER_MAX_CHARS);
  if (!text) return { ok: false, reason: 'rejected' };
  try {
    const p = await previewMealAnswer({
      asked_about: (row.asked_about ?? row.name).slice(0, ASKED_ABOUT_MAX_CHARS),
      answer: text,
      chosen,
      ...(meal ? { meal } : {}),
    });
    return p.items.length ? { ok: true, preview: p } : { ok: false, reason: 'failed' };
  } catch (e) {
    const status = e && typeof e === 'object' ? (e as { status?: unknown }).status : undefined;
    return { ok: false, reason: status === 400 ? 'rejected' : 'failed' };
  }
}
