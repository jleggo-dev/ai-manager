/**
 * Tokens for deciding whether two TELLINGS of a captured fact are the same fact.
 *
 * Word-set comparison already guards constraint and equipment dedup, but raw words fail on
 * exactly the variation people (and models) actually produce. The owner's file on 2026-08-31
 * held four rows for one Wednesday fact and two for one piano class, split by nothing but:
 *
 *   - plurals:   "Weekly piano class on Saturdays" vs "Saturday piano class"
 *   - stopwords: "Wednesday afternoons — at work" vs "work on Wednesday afternoons"
 *   - numbers:   "two 50lb dumbbells" vs "2x50lb dumbbells"
 *
 * So: lowercase, punctuation → spaces, digit-times-digit compounds split ("2x50lb" → "2 50lb"),
 * number words folded to digits, function words dropped, and a naive plural fold. The folds are
 * linguistically crude on purpose — both sides are folded the SAME way, so a wrong stem still
 * compares equal to itself ("class" and "class" both keep their double-s), and the one failure
 * mode is two different words colliding, which the callers' containment/equality rules and the
 * stated cost asymmetry (constraint-merge.ts: a false split accumulates forever, a false merge
 * keeps the fuller label) already price in.
 *
 * Pure and dependency-free, like goal-identity.ts, so the rule is unit-testable on its own.
 * Goals deliberately do NOT use this: their matcher keeps stopwords to make containment harder
 * (a wrongly merged goal is something the user watched disappear).
 */

const NUMBER_WORDS: Record<string, string> = {
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
};

/** Function words that carry no identity. Meaning-bearing small words ("no", "only", "can")
 *  stay — "no afternoon workout" must not collapse into "afternoon workout". */
const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'to',
  'at',
  'on',
  'in',
  'of',
  'for',
  'with',
  'and',
  'or',
  'my',
  'their',
  'i',
  'is',
  'are',
]);

/** Naive plural fold: trailing s off words of 4+ letters, double-s kept ("class" stays whole). */
function foldPlural(w: string): string {
  return w.length >= 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
}

export function factTokens(label: string): string[] {
  return label
    .toLowerCase()
    .replace(/(\d)\s*x\s*(\d)/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((w) => NUMBER_WORDS[w] ?? w)
    .filter((w) => !STOPWORDS.has(w))
    .map(foldPlural);
}

/** Every token of the shorter side appears in the longer — "one is the other plus qualifiers".
 *  A single-token shorter side needs 4+ characters, so "arm" cannot swallow "warm-up band". */
export function factTokensContained(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length === 1 && shorter[0]!.length < 4) return false;
  const pool = new Set(longer);
  return shorter.every((w) => pool.has(w));
}

/**
 * The equipment rule, stricter than the constraint one: token-set EQUALITY ("two 50lb
 * dumbbells" ≡ "2x50lb dumbbells"), or containment only when the shorter name itself has two
 * or more tokens ("Suzuki book" folds into "Suzuki Book 2"). A single word never absorbs a
 * longer name — a "bike" and a "bike trainer" are different machines in the same garage,
 * where a "knee" and a "left knee — patellar tendinopathy" are one knee.
 */
export function sameEquipmentName(a: string, b: string): boolean {
  const ta = factTokens(a);
  const tb = factTokens(b);
  if (!ta.length || !tb.length) return false;
  const sa = new Set(ta);
  const sb = new Set(tb);
  if (sa.size === sb.size && [...sa].every((w) => sb.has(w))) return true;
  const shorter = ta.length <= tb.length ? ta : tb;
  return shorter.length >= 2 && factTokensContained(ta, tb);
}
