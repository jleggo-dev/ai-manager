/**
 * One tap's protein / carbs / fat as the quick-log tile prints it. Single letters on the meal
 * drawer only (owner, 2026-10-28) — a scoped exception to BRAND.md's no-abbreviation rule.
 */
import type { ShelfTile } from './useShelves.ts';

/** "P 12 · C 30 · F 8" — whichever of the three the tile knows; nothing when it knows none. */
export function macroLine(m: ShelfTile['macros']): string | null {
  if (!m) return null;
  const parts = (
    [
      ['P', m.protein_g],
      ['C', m.carbs_g],
      ['F', m.fat_g],
    ] as const
  ).flatMap(([l, v]) => (typeof v === 'number' ? [`${l} ${Math.round(v)}`] : []));
  return parts.length ? parts.join(' · ') : null;
}
