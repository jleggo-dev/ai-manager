import { previewMealAnswer, type MealKind, type MealPreview } from '../../lib/api.ts';

/**
 * The re-read behind a tapped choice or a typed answer (MealQuestionChoices): the part's words
 * and the answer go to the server as one part through the same read, and the rows for that part
 * come back priced. One helper for every host — the confirm card's hook and the quick-log sheet —
 * so they send the same thing. Null when the re-read failed or came back with nothing; the host
 * then leaves the asked row as it was. Never throws.
 */
export async function reReadAnswer(
  row: { name: string; asked_about?: string },
  answer: string,
  chosen: boolean,
  meal?: MealKind,
): Promise<MealPreview | null> {
  try {
    const p = await previewMealAnswer({
      asked_about: row.asked_about ?? row.name,
      answer,
      chosen,
      ...(meal ? { meal } : {}),
    });
    return p.items.length ? p : null;
  } catch {
    return null;
  }
}
