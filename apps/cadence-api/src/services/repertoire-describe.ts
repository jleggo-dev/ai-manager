import { normTitle } from './goal-identity.ts';

/* ── Describing a piece instead of naming it ─────────────────────────────────────────────────
   The needles above all require the label's own words CONTIGUOUSLY. That is right for a title and
   useless for a person: "played the minuet from the Anna Magdalena notebook" names a piece on the
   shelf perfectly clearly and matched nothing at all, because the stored label reads "Minuet in G
   Major (from Notebook for Anna Magdalena Bach)".

   So a second, looser route — deliberately fenced, because loosening recall is exactly how a false
   hit gets in, and a false hit writes the wrong piece's history and never corrects itself:

     • it reads CONTENT words, not word order, so a description in someone's own phrasing counts;
     • two coverage gates must BOTH pass — see `describedItems` for why either alone is trickable;
     • words the shelf shares ("minuet", "in G major") can never decide, which is the shared-needle
       rule above applied per word rather than per needle;
     • each text is scored SEPARATELY, never concatenated. The stamp path is handed the log, the
       summary and the whole prescription at once; scored as one blob, a label's words would be
       scattered across unrelated sentences and half a shelf would "match". */

/** Words carrying no identity: articles, prepositions, and the catalogue scaffolding half a shelf
 *  shares. The NUMBER after "Op."/"No." is the distinguishing part, so only the marker is dropped. */
const IGNORED_WORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'by',
  'for',
  'from',
  'in',
  'no',
  'nos',
  'of',
  'on',
  'op',
  'the',
  'to',
]);

/** The distinct content words of a label or a sentence, normalized. */
export function contentWords(text: string): string[] {
  return [
    ...new Set(
      normTitle(text)
        .split(' ')
        .filter((w) => w && !IGNORED_WORDS.has(w)),
    ),
  ];
}

/**
 * Two gates, because either alone is trickable.
 *
 * DISTINGUISHING coverage asks "did they say the things that make this piece itself" — half of the
 * words no other item on the shelf carries. On its own it over-fires on a piece whose one
 * distinguishing word is ordinary English: "Children at Play" is distinguished only by "play"
 * among these, and "I play piano every day" would claim it.
 *
 * OVERALL coverage asks "were they talking about this piece at all" — a third of everything in the
 * label. On its own it under-fires on long catalogue labels, where the tail ("Album for the Young,
 * Op. 68, No. 10") dilutes the words that actually name the thing.
 *
 * Together they behave: "did the happy farmer twice" passes both, "my playing felt happy today"
 * fails both, and "I play piano every day" fails the overall gate.
 */
const MIN_DISTINGUISHING_COVERAGE = 0.5;
const MIN_OVERALL_COVERAGE = 0.3;

/**
 * "1" and "10" are the No. in a catalogue tail; "822" and "114" are a BWV number. The short ones
 * are not evidence AND not a fair thing to require: nobody says "Op. 13, No. 2" out loud, so
 * counting those two toward what a description must cover made "the cradle song by Weber" — which
 * names the piece perfectly — fail on the words the person had no reason to say.
 *
 * They still count toward overall coverage; they just cannot distinguish, and cannot be demanded.
 */
const isWeakNumber = (word: string): boolean => /^\d{1,2}$/.test(word);

/**
 * Items that a natural description names, judged per text. See the block comment above for why
 * each fence is there.
 */
export function describedItems<T extends { label: string }>(items: T[], texts: Array<string | null | undefined>): T[] {
  const shelfFrequency = new Map<string, number>();
  for (const i of items) for (const w of contentWords(i.label)) shelfFrequency.set(w, (shelfFrequency.get(w) ?? 0) + 1);

  const hits = new Set<T>();
  for (const text of texts) {
    if (!text?.trim()) continue;
    const said = new Set(contentWords(text));
    if (said.size === 0) continue;
    for (const item of items) {
      const words = contentWords(item.label);
      if (words.length === 0) continue;
      // Words no other item carries. An item with none is indistinguishable by words alone — its
      // full title still matches through the needles, but a description cannot reach it.
      const own = words.filter((w) => shelfFrequency.get(w) === 1 && !isWeakNumber(w));
      if (own.length === 0) continue;

      const matchedOwn = own.filter((w) => said.has(w));
      if (matchedOwn.length / own.length < MIN_DISTINGUISHING_COVERAGE) continue;

      const matchedAll = words.filter((w) => said.has(w));
      if (matchedAll.length / words.length < MIN_OVERALL_COVERAGE) continue;

      hits.add(item);
    }
  }
  return items.filter((i) => hits.has(i));
}
