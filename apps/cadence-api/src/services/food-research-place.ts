/**
 * A place in a researched answer that the person did not name — the guard behind the
 * research-food prompt's name/brand rule (FOOD-LOGGING-COACH-LED.md, 2026-11-03).
 *
 * The web rung exists to get past a chain's menu row of a maker's product ("Perkins Restaurant
 * Rickard's Red Beer"): the lookup is for the maker's own record, and what it returns is pinned
 * as the person's food for good. Four live calls for "Rickard's — Red" on 2026-11-03 answered
 * four ways, and one put the restaurant in both fields — "Rickard's Red Beer (Perkins
 * Restaurant)" by "Perkins Restaurant & Bakery". The prompt now says where a restaurant may
 * appear (brand, for a dish it cooks itself); this guard refuses the answer the prompt did not
 * stop: a word that names a place (restaurant, bakery, diner, steakhouse, pizzeria, bistro,
 * eatery, bar & grill) in name or brand, where the place is not the maker the person named and
 * the word is not one they said.
 *
 * Not caught, on purpose: a chain whose name carries no place word ("Boston Pizza", "Tim
 * Hortons") — only the prompt keeps those out. And the words that are products, not places —
 * "Caffè Latte", "Café Bustelo", "Grill Mates", "Bar Harbor", "Pub Mix", "Amy's Kitchen" — so
 * cafe, grill, bar, pub and kitchen are not place words here, and "restaurant style" is a flavour.
 * One cost accepted: a maker whose own name carries a place word, found for a retailer the person
 * named ("Costco — cheesecake" answered by "The Cheesecake Factory Bakery"), is refused too; the
 * item then falls through to the estimate instead of pinning a row for nothing.
 */

/** A word that names a place that serves or sells food. Not a product's own word — see the header. */
const PLACE_WORD =
  /\b(restaurants?|bakery|bakeries|diner|steakhouse|pizzeria|bistro|eatery|bar\s*(?:&|and)\s*grill|grill\s*(?:&|and)\s*bar)\b(?![\s-]+style\b)/gi;

/** Where one phrase ends and another starts inside a name: brackets, commas, dashes, "at", "from". */
const SEGMENT_EDGE = /[()[\]{},|:;]|\s[-–—]\s|\s(?:at|from)\s/i;

/** How many words a fuller name of the maker may carry between what the person said and the
 *  place word: "Perkins Family Restaurant" for "Perkins", "Bob Evans Farms Restaurant" for
 *  "Bob Evans". More than that and it is some other place after their words. */
const MAKER_SUFFIX_WORDS = 2;

/** How many words before the place word the refusal quotes. */
const PHRASE_WORDS = 3;

/** Lower case, accents and apostrophes gone, one space between words: "Rickard’s" → "rickards". */
export function foldWords(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** What the lookup was asked: the food in the person's words and the maker they named, if any. */
export interface AskedFood {
  name: string;
  brand: string | null;
}

/**
 * The place phrase in `field` that the person did not name, or null when there is none.
 *
 * "Perkins Restaurant" for the name "Rickard's Red Beer (Perkins Restaurant)" asked as
 * Rickard's; null for "Perkins Restaurant Buttermilk Pancakes" asked as Perkins, because there the
 * place is the maker they named. A table of both kinds: food-research-place.test.ts.
 */
export function placeNotAsked(field: string, asked: AskedFood): string | null {
  const saidWords = foldWords(`${asked.brand ?? ''} ${asked.name}`);
  const saidBrand = foldWords(asked.brand ?? '');
  for (const segment of field.split(SEGMENT_EDGE)) {
    for (const m of segment.matchAll(PLACE_WORD)) {
      const at = m.index ?? 0;
      // They said the word themselves.
      if (saidWords.includes(foldWords(m[0]))) continue;
      const before = segment.slice(0, at);
      if (saidBrand && isMakerTheyNamed(foldWords(before), saidBrand)) continue;
      const beforeWords = before.trim().split(/\s+/).filter(Boolean);
      return [...beforeWords.slice(-PHRASE_WORDS), m[0]].join(' ');
    }
  }
  return null;
}

/** The place word closes the maker they named, by its fuller name: "Perkins Restaurant & Bakery",
 *  "Perkins Family Restaurant" for "Perkins". Not "Rickard's Red Beer Perkins Restaurant". */
function isMakerTheyNamed(foldedBefore: string, saidBrand: string): boolean {
  const start = foldedBefore.indexOf(saidBrand);
  if (start < 0) return false;
  const between = foldedBefore.slice(start + saidBrand.length).trim();
  return (between ? between.split(' ').length : 0) <= MAKER_SUFFIX_WORDS;
}
