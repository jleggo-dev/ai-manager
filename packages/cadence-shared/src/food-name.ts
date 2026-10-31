/**
 * What a food is called on screen: the brand in front when the name alone would not say what it
 * is. "Lemon-lime" from Gatorade reads as a lime (owner, 2026-10-31); "Gatorade Lemon-lime" does
 * not. A name that already carries its brand ("Starbucks Caffè Latte") is left as it is.
 *
 * Display only — the stored `name` and `brand` stay apart, so the matcher and the coach still see
 * them as two fields.
 */

const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** True when `brand` appears in `name` as whole words, accents and punctuation ignored. */
function namesBrand(name: string, brand: string): boolean {
  const b = fold(brand);
  return !!b && ` ${fold(name)} `.includes(` ${b} `);
}

export function brandedFoodName(name: string, brand?: string | null): string {
  const b = brand?.trim();
  if (!b || namesBrand(name, b)) return name;
  return `${b} ${name}`;
}
