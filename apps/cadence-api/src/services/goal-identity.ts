/**
 * What makes two goal titles the SAME goal.
 *
 * Ambient capture re-runs on every conversational turn against the whole window, so the model is
 * forever re-expressing its own earlier extraction in slightly different words. A real device run
 * produced "Spartan Ultrabeast" on one turn and "Spartan Ultra Beast" on the next — one race, two
 * goal cards. A title is not an identity; this module is the closest thing goals have to one.
 *
 * Pure and dependency-free so the rule that decides whether someone's goal is kept or merged is
 * unit-testable on its own.
 *
 * The bias is deliberately asymmetric: a duplicated goal is an annoyance the next capture run can
 * still collapse, but a WRONGLY MERGED goal is something the user said out loud and then watched
 * disappear. Every threshold here errs toward leaving two goals apart.
 */

/**
 * Lowercase, punctuation → spaces, collapsed — and "an" folded into "a". The comparison form for
 * word-level rules.
 *
 * The article fold is a real-device scar (2026-08-13): "Run an Ultra Beast Spartan Race" and
 * "Run a Spartan Ultra Beast" shared every content word, and the subset test still failed —
 * on "a" ≠ "an". Keeping articles in the word set is deliberate (they make containment harder
 * to pass); treating English's two spellings of the SAME article as different words is not.
 */
export const normTitle = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\ban\b/g, 'a')
    .trim();

/**
 * Every separator removed — "Ultra Beast", "Ultrabeast" and "ultra-beast" all become
 * "ultrabeast". Word boundaries are exactly what models move around between turns, so the compact
 * form is the one place they can't hide.
 */
export const compactTitle = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Below this many characters a compact title is too short to be evidence of anything: "row" sits
 * inside "grow strong" and "run" inside "run a 10k", and neither containment means what it looks
 * like. Long enough that a real multi-word goal name clears it; short enough that "ultrabeast"
 * (10) plus any qualifier does.
 */
const MIN_CONTAINED_COMPACT = 12;

/**
 * The strict rule: the same goal NAMED the same way, ignoring only case, punctuation and word
 * boundaries. "Spartan Ultrabeast" === "Spartan Ultra Beast". "Run a 10k" !== "Run a 10k this
 * spring" — that is a more specific goal, not a rewording, and the distinction is load-bearing
 * where a user has already confirmed one of them.
 */
export function sameGoalIdentity(a: string, b: string): boolean {
  const ca = compactTitle(a);
  return ca.length > 0 && ca === compactTitle(b);
}

/**
 * Every word of the shorter title also appears in the longer one — "Lose weight" inside "Lose
 * some weight", "Run a 10k" inside "Run a 10k this spring". This is what "one is the other plus
 * qualifiers" actually means once the model starts inserting words mid-phrase.
 *
 * Two words minimum, and no stopword stripping: a single word is never enough evidence ("Row"
 * must not swallow "Grow strong", which the old plain-substring rule silently allowed), and
 * keeping "a"/"the" in the set makes the subset test harder to pass, not easier.
 */
function wordsContained(na: string, nb: string): boolean {
  const wa = na.split(' ');
  const wb = nb.split(' ');
  const [shorter, longer] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  if (shorter.length < 2) return false;
  const pool = new Set(longer);
  return shorter.every((w) => pool.has(w));
}

/**
 * The working rule for pre-confirmation goals: the same identity, OR one title is the other plus
 * qualifiers. Two containment tests, both narrow on purpose:
 *
 *  - word containment (above), which survives words inserted anywhere in the phrase;
 *  - compact containment, which survives a moved word BOUNDARY — "Spartan Ultrabeast" inside
 *    "Complete the Spartan Ultra Beast in Quebec", where no word-level test can help because
 *    "ultrabeast" is not a word on the other side. Gated on MIN_CONTAINED_COMPACT so what matches
 *    is a name rather than a fragment.
 *
 * What this deliberately does NOT do is judge meaning. There is no similarity score and no
 * synonym list, because the moment sameness becomes a matter of degree, two goals a user actually
 * holds — "lose weight" and "run a 50 km" — start rounding into one. Every rule here needs the
 * whole of one title to be present in the other.
 */
export function sameGoalTitle(a: string, b: string): boolean {
  const na = normTitle(a);
  const nb = normTitle(b);
  if (!na || !nb) return false;
  if (sameGoalIdentity(a, b)) return true;
  if (wordsContained(na, nb)) return true;
  const ca = compactTitle(a);
  const cb = compactTitle(b);
  const [shorter, longer] = ca.length <= cb.length ? [ca, cb] : [cb, ca];
  return shorter.length >= MIN_CONTAINED_COMPACT && longer.includes(shorter);
}
