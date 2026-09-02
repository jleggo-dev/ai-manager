/**
 * The ONE regex that decides whether an occurrence/activity title IS the weekly check-in.
 *
 * Before this it was duplicated by hand in two places — the server's local-notification producer
 * (`notify/local-plan.ts`'s `findWeeklyCheckin`, deciding when to schedule the on-device reminder)
 * and the client's occurrence formatter (`occurrence/format.ts`'s `isWeeklyCheckin`, deciding which
 * card the week screen renders) — each carrying a comment warning the two must never disagree. The
 * notification is the door and the review screen is the room; they have to agree on which occurrence
 * is which, so the match lives here once and both call sites import it.
 *
 * Excludes weigh-in titles (kept from the web version, which had it and the server version didn't)
 * so a weigh-in row can never be double-claimed by both matchers — the weigh-in has its own
 * matcher just below, and this one steps aside from anything that word already owns.
 */
export function isWeeklyCheckinTitle(title: string): boolean {
  return /check-?in|recap/i.test(title) && !isWeighInTitle(title);
}

/**
 * The ONE regex that decides whether a title IS a weigh-in — the row that opens the scale sheet
 * and accepts a weight.
 *
 * It was `/weigh/i`, hand-copied into seven places across the server and the client, and on
 * 2026-09-01 the owner tapped "Weighted hill intervals (vest or sandbag) + grip finisher" and was
 * asked what the scale said. The client routed the tap by that substring; the server then refused
 * the weight (404, not a weigh-in row) — so the wrong sheet opened AND the number failed to save.
 * "Weighted", "weights", "body weight squats" all contain the letters; none of them is a weigh-in.
 *
 * The verb has to stand as its own word: "Weigh-in", "Weigh in", "Weekly weigh-in", "Weigh
 * yourself", "Weighing day". A word that merely starts with it does not count.
 */
export function isWeighInTitle(title: string): boolean {
  return /\bweigh(?:-?in|ing)?\b/i.test(title);
}

/** The same rule as `isWeighInTitle`, for a Postgres `~*` (case-insensitive ARE) match. `\m`/`\M`
 *  are Postgres' word-boundary escapes. Kept beside the regex it mirrors so the two cannot drift. */
export const WEIGH_IN_TITLE_SQL_PATTERN = '\\mweigh(-?in|ing)?\\M';
