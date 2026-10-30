/**
 * The filter bar's match (canvas "Cadence Quick Log", 2026-10-29): Find only ever searched your
 * saved foods, so it filters the shelves those foods are on — every shelf at once, each food once.
 *
 * A word matches when every word typed starts a word of the tile's name or line ("gre yog" finds
 * "Greek yogurt, 2%"), accents folded. A bare substring would let "egg" claim "Veggie burger".
 */
import type { ShelfKey, ShelfTile } from './useShelves.ts';

const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const words = (s: string): string[] =>
  fold(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

export function tileMatches(tile: Pick<ShelfTile, 'name' | 'sub'>, query: string): boolean {
  const asked = words(query);
  if (asked.length === 0) return false;
  const have = words(`${tile.name} ${tile.sub ?? ''}`);
  return asked.every((a) => have.some((h) => h.startsWith(a)));
}

/** Matches across the shelves in shelf order; a food on two shelves shows once, from the first. */
export function findTiles(
  shelves: Partial<Record<ShelfKey, ShelfTile[]>>,
  order: ShelfKey[],
  query: string,
): ShelfTile[] {
  const seen = new Set<string>();
  const out: ShelfTile[] = [];
  for (const key of order) {
    for (const t of shelves[key] ?? []) {
      const id = `${t.kind}:${t.id}`;
      if (seen.has(id) || !tileMatches(t, query)) continue;
      seen.add(id);
      out.push(t);
    }
  }
  return out;
}
