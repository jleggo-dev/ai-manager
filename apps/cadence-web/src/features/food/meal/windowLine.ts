/**
 * The meal header's one quiet line — it says only what the list cannot. In order of what earns
 * the room:
 *
 *   • two or more loose rows → "drag things together to make a recipe" — the one gesture nobody
 *     finds on their own (owner, 2026-09-08: "there's no indication that you can group things");
 *   • the cart is open → the window, "adds until 11:02" — visible on-surface, never a silent rule.
 *     The hint wins when both apply: one sentence, never two (owner, 2026-09-08: "don't add more
 *     words");
 *   • empty → "nothing in it yet";
 *   • logged, nothing to group → nothing. The LOGGED chip already says so, and "anything you add
 *     counts right away" was a line that "adds no value or clarity" (owner, 2026-09-08).
 */
export const GROUP_HINT = 'drag things together to make a recipe';

export function windowLine(opts: {
  empty: boolean;
  logged: boolean;
  addsUntil: string | null;
  /** Loose rows — items outside every bracket. Two or more and the hint leads the line. */
  loose: number;
}): string {
  const { empty, logged, addsUntil, loose } = opts;
  if (loose >= 2) return GROUP_HINT;
  if (logged) return '';
  if (empty) return [addsUntil, 'nothing in it yet'].filter(Boolean).join(' · ');
  return addsUntil ?? '';
}
