/**
 * The tiles (quick log, 2026-10-28): two columns, words and kcal, no photos — no library covers
 * every food, and a name with a number is faster to scan than a picture. The list scrolls on
 * without end (the shelf's own reads cap it, not this). Tap = +1, tap again = ×2 (the badge),
 * hold = the amount sheet. A swipe across the pane moves to the next shelf.
 *
 * Empty shelves say one honest line each; the Planned shelf is never empty because its tab is
 * absent when there is nothing planned.
 */
import { badgeFor } from './cartModel.ts';
import { fmtKcal } from '../bracket/copy.ts';
import { useHoldTap, useSwipe } from './useShelfGestures.ts';
import type { ShelfKey, ShelfTile } from './useShelves.ts';

const EMPTY: Record<ShelfKey, string> = {
  planned: '',
  usual: 'Nothing here yet — what you log at this meal lands here, most-often first.',
  leftovers: 'Nothing cooked in multiples in the last four days.',
  cookbook: 'Nothing saved yet. Name a bracket in any meal and it lands here.',
};

function Tile({
  tile,
  count,
  busy,
  onTap,
  onHold,
}: {
  tile: ShelfTile;
  count: number;
  busy?: boolean;
  onTap: (t: ShelfTile) => void;
  onHold?: (t: ShelfTile) => void;
}) {
  const handlers = useHoldTap(() => onTap(tile), onHold ? () => onHold(tile) : undefined);
  return (
    <button
      type="button"
      className={`ms-tile${count > 0 ? ' is-on' : ''}`}
      disabled={busy}
      aria-label={`${tile.name}${tile.sub ? `, ${tile.sub}` : ''}${count > 0 ? ` — in the cart ${badgeFor(count)}` : ''}`}
      {...handlers}
    >
      <span className="ms-tile-w">
        <span className="ms-tile-n">{tile.name}</span>
        {tile.sub && <span className="ms-tile-s">{tile.sub}</span>}
      </span>
      <span className="ms-tile-k">
        <b>{fmtKcal(tile.kcal ?? undefined)}</b>
        <i>KCAL</i>
      </span>
      {count > 0 && (
        <span className="ms-tile-badge" aria-hidden>
          {badgeFor(count)}
        </span>
      )}
    </button>
  );
}

export function ShelfGrid({
  shelf,
  tiles,
  countOf,
  busy,
  onTap,
  onHold,
  onSwipe,
}: {
  shelf: ShelfKey;
  tiles: ShelfTile[];
  countOf: (t: ShelfTile) => number;
  busy?: boolean;
  onTap: (t: ShelfTile) => void;
  /** Absent for a tile kind that has no amount to ask about (a planned dish). */
  onHold?: (t: ShelfTile) => void;
  onSwipe: (dir: 1 | -1) => void;
}) {
  const swipe = useSwipe(onSwipe);
  return (
    <div className="ms-shelf-scroll" {...swipe.handlers}>
      <div
        className="ms-grid"
        role="tabpanel"
        style={{
          transform: `translateX(${swipe.dx}px)`,
          opacity: 1 - Math.min(0.5, Math.abs(swipe.dx) / 300),
          transition: swipe.swiping ? 'none' : 'transform 0.25s ease, opacity 0.25s ease',
        }}
      >
        {tiles.map((t) => (
          <Tile
            key={t.key}
            tile={t}
            count={countOf(t)}
            busy={busy}
            onTap={onTap}
            onHold={t.kind === 'planned' ? undefined : onHold}
          />
        ))}
        {tiles.length === 0 && EMPTY[shelf] && <p className="ms-shelf-empty">{EMPTY[shelf]}</p>}
      </div>
    </div>
  );
}
