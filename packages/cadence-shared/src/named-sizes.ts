/**
 * The ONE list of words that name a menu size rather than a measure.
 *
 * "Venti" in "Starbucks, Venti latte" reaches the server as the item's `unit`, and a unit is
 * normally a measure ("g", "cup", "slice") that prices a food already found. A size word is
 * different: it picks WHICH food. Chains list each size as its own row — "Caffè Latte (Venti)" and
 * "Caffè Latte (Grande)" are two foods with two labels — so a size left out of the search finds the
 * wrong row, and the portion arithmetic afterwards cannot fix that.
 *
 * Deliberately a closed list. "cup", "bowl" and "slice" are not sizes: adding one to a search would
 * turn "a cup of oatmeal" into a hunt for products named "cup".
 */
const NAMED_SIZES = [
  'short',
  'tall',
  'grande',
  'venti',
  'trenta',
  'small',
  'medium',
  'large',
  'regular',
  'kids',
  'junior',
  'jumbo',
  'xl',
  'extra large',
] as const;

export type NamedSize = (typeof NAMED_SIZES)[number];

const NAMED_SIZE_SET: ReadonlySet<string> = new Set(NAMED_SIZES);

/** The size word this unit names, lowercased — or null when it is a measure or nothing at all. */
export function namedSizeOf(unit: string | null | undefined): NamedSize | null {
  const key = (unit ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return NAMED_SIZE_SET.has(key) ? (key as NamedSize) : null;
}
