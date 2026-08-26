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
 * Excludes `/weigh/i` (kept from the web version, which had it and the server version didn't) so a
 * weigh-in row can never be double-claimed by both matchers — the weigh-in has its own dedicated
 * lookup (`findWeighInOccurrence`/`findWeighInActivity` in repos/occurrences.ts), matched on `/weigh/i`
 * alone, and this one steps aside from anything that word already owns.
 */
export function isWeeklyCheckinTitle(title: string): boolean {
  return /check-?in|recap/i.test(title) && !/weigh/i.test(title);
}
