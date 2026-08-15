/**
 * Is this text ONE food, or a MEAL of several?
 *
 * The two deserve different pipelines and only one question. A single food ("nonfat greek
 * yogurt, 170g") goes to the resolver — match a saved food, confirm a portion. A composed meal
 * ("1 cup frozen strawberries, 1/3 cup vanilla yogurt, 2/3 cup skyr, 1 scoop protein powder")
 * goes to the meal parser, which itemizes it — because the person already GAVE the quantities,
 * and asking them to "select the serving size" of a five-ingredient smoothie is asking a
 * question their message already answered (owner, 2026-08-15).
 *
 * Deterministic on purpose: a wrong guess here is visible and recoverable (both cards carry an
 * escape hatch to the other pipeline), so a legible rule beats a classifier.
 */

/** Fraction glyphs people actually type, plus "1/3"-style slashes, plus plain digits. */
const QTY = /(\d+([./]\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞])/;
/** Measures that make a segment a quantified ingredient even without reading units carefully. */
const MEASURE =
  /\b(cups?|c\b|tbsps?|tablespoons?|tsps?|teaspoons?|scoops?|grams?|g\b|kgs?|oz\b|ounces?|ml\b|l\b|liters?|litres?|slices?|pieces?|eggs?|cans?|handfuls?|servings?)\b/i;

/** Split into candidate ingredient segments the way people separate them when typing. */
export function mealSegments(text: string): string[] {
  return text
    .split(/,|\n|;|\+| and | with /i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A segment counts as a quantified ingredient when it carries an amount. */
export function isQuantified(segment: string): boolean {
  return QTY.test(segment) || MEASURE.test(segment);
}

/**
 * Two or more quantified segments = a composed meal. One quantified segment ("170g yogurt") is
 * still a single food with a portion — the resolver's home turf — and zero quantities anywhere
 * ("turkey chili bowl") is a name, which is also the resolver's job.
 */
export function looksLikeMultiItemMeal(text: string): boolean {
  const segments = mealSegments(text);
  if (segments.length < 2) return false;
  return segments.filter(isQuantified).length >= 2;
}
