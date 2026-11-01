/**
 * The two sparse row flags, read from the words themselves. `parse-meal` set them only on an
 * explicit mention and never inferred (0013); the food-check shape has no flags, so the same rule
 * is a word list here — a named drink, nothing guessed. A router, so it ships with a table test.
 */
const ALCOHOL =
  /\b(beer|beers|lager|ale|ipa|stout|cider|wine|prosecco|champagne|whisky|whiskey|bourbon|vodka|gin|rum|tequila|mezcal|sake|cocktail|margarita|negroni|spritz|mimosa|sangria)\b/i;
const CAFFEINE =
  /\b(coffee|espresso|americano|latte|cappuccino|cortado|flat white|macchiato|mocha|cold brew|black tea|green tea|earl grey|matcha|chai|yerba|mate|energy drink|red bull|monster|cola|coke|pepsi)\b/i;

export function mealFlags(text: string): { alcohol?: true; caffeine?: true } {
  return {
    ...(ALCOHOL.test(text) ? { alcohol: true as const } : {}),
    ...(CAFFEINE.test(text) ? { caffeine: true as const } : {}),
  };
}
