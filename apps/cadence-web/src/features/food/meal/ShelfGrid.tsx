/**
 * The tiles (quick log, 2026-10-28): two columns, words and kcal, no photos — no library covers
 * every food, and a name with a number is faster to scan than a picture. The list scrolls on
 * without end: a shelf that pages (Usual) hands `onEnd`, and a marker under the last tile asks
 * for the next page as it comes into view. Tap = +1, tap again = ×2 (the badge),
 * hold = the amount sheet. A swipe across the pane moves to the next shelf.
 *
 * Under the name, one tap's macros as "P 12 · C 30 · F 8" — single letters on THIS surface only
 * (owner, 2026-10-28: the words do not fit a half-width tile; a scoped exception to BRAND.md's
 * no-abbreviation rule, recorded there and in MEAL-LOGGING.md).
 *
 * A press draws itself: the tile sinks, and a holdable one fills toward the hold, so the
 * gesture shows itself the first time a finger rests (useHoldHint carries the one-time line).
 *
 * Empty shelves say one honest line each; the Planned shelf is never empty because its tab is
 * absent when there is nothing planned.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { badgeFor } from './cartModel.ts';
import { fmtKcal } from '../bracket/copy.ts';
import { HOLD_MS, useHoldTap, useSwipe } from './useShelfGestures.ts';
import { HOLD_HINT } from './useHoldHint.ts';
import { macroLine } from './macroLine.ts';
import type { ShelfKey, ShelfTile } from './useShelves.ts';

const EMPTY: Record<ShelfKey, string> = {
  planned: '',
  usual: 'Nothing here yet — what you log at this meal lands here, most recent first.',
  leftovers: 'Nothing logged in that window yet — meals you log land here, newest first.',
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
  const [pressing, setPressing] = useState(false);
  const handlers = useHoldTap(() => onTap(tile), onHold ? () => onHold(tile) : undefined, setPressing);
  const line = macroLine(tile.macros);
  return (
    <button
      type="button"
      className={`ms-tile${count > 0 ? ' is-on' : ''}${pressing ? ' is-pressing' : ''}${onHold ? ' can-hold' : ''}`}
      style={{ '--hold-ms': `${HOLD_MS}ms` } as CSSProperties}
      disabled={busy}
      aria-label={`${tile.name}${tile.sub ? `, ${tile.sub}` : ''}${count > 0 ? ` — in the cart ${badgeFor(count)}` : ''}`}
      {...handlers}
    >
      <span className="ms-tile-w">
        <span className="ms-tile-n">{tile.name}</span>
        {tile.sub && <span className="ms-tile-s">{tile.sub}</span>}
        {line && <span className="ms-tile-m">{line}</span>}
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

/** Calls `onEnd` when it scrolls into view (or straight away where there is no observer). */
function EndMarker({ onEnd }: { onEnd: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(onEnd);
  latest.current = onEnd;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      latest.current();
      return;
    }
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && latest.current(), {
      rootMargin: '300px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className="ms-shelf-end" aria-hidden />;
}

export function ShelfGrid({
  shelf,
  tiles,
  countOf,
  busy,
  onTap,
  onHold,
  onSwipe,
  hint,
  onEnd,
}: {
  shelf: ShelfKey;
  tiles: ShelfTile[];
  countOf: (t: ShelfTile) => number;
  busy?: boolean;
  onTap: (t: ShelfTile) => void;
  /** Absent for a tile kind that has no amount to ask about (a planned dish). */
  onHold?: (t: ShelfTile) => void;
  onSwipe: (dir: 1 | -1) => void;
  /** The one-time "hold a tile" line — shown only where a tile on this shelf can be held. */
  hint?: boolean;
  /** This shelf has another page: called as its bottom comes into view. */
  onEnd?: () => void;
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
        {hint && onHold && tiles.some((t) => t.kind === 'food' || t.kind === 'recipe') && (
          <p className="ms-hold-hint">{HOLD_HINT}</p>
        )}
        {tiles.map((t) => (
          <Tile
            key={t.key}
            tile={t}
            count={countOf(t)}
            busy={busy}
            onTap={onTap}
            onHold={t.kind === 'food' || t.kind === 'recipe' ? onHold : undefined}
          />
        ))}
        {tiles.length === 0 && !onEnd && EMPTY[shelf] && <p className="ms-shelf-empty">{EMPTY[shelf]}</p>}
        {onEnd && <EndMarker key={`${shelf}:${tiles.length}`} onEnd={onEnd} />}
      </div>
    </div>
  );
}
