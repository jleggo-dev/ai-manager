import type { ShoppingListItem } from '@cadence/shared';

/** Store-shaped aisle order + labels — the design's PRODUCE / BUTCHER / TINS & DRY / DAIRY (G). */
export const AISLES: Array<{ key: string; label: string }> = [
  { key: 'produce', label: 'PRODUCE' },
  { key: 'protein', label: 'BUTCHER & PROTEIN' },
  { key: 'pantry', label: 'TINS & DRY' },
  { key: 'dairy', label: 'DAIRY' },
  { key: 'frozen', label: 'FROZEN' },
  { key: 'bakery', label: 'BAKERY' },
  { key: 'other', label: 'ANYTHING ELSE' },
];

export interface AisleGroup {
  label: string;
  rows: Array<{ item: ShoppingListItem; index: number }>;
}

/**
 * Group a shopping list the way the shop is laid out, keeping each item's index into the original
 * list so a tick can be written back to the right row.
 *
 * Shared by the two surfaces that show a list: the shop (a saved week's list, ticks persisted) and
 * the Kitchen (a list derived from what is planned, ticks local). Same walking order either way.
 */
export function groupByAisle(list: ShoppingListItem[]): AisleGroup[] {
  const byCat = new Map<string, Array<{ item: ShoppingListItem; index: number }>>();
  list.forEach((item, index) => {
    const cat = (item.category?.toString().trim() || 'other').toLowerCase();
    const key = AISLES.some((a) => a.key === cat) ? cat : 'other';
    const rows = byCat.get(key) ?? [];
    rows.push({ item, index });
    byCat.set(key, rows);
  });
  return AISLES.filter((a) => byCat.has(a.key)).map((a) => ({ label: a.label, rows: byCat.get(a.key) ?? [] }));
}
