/**
 * The shelf switch (quick log, 2026-10-28) — a segmented pill: Planned (only when the week
 * names a dish for this slot) · Usual · Leftovers · Cookbook. The tab is the only label the
 * tiles get.
 */
import { SHELF_LABELS, type ShelfKey } from './useShelves.ts';

export function ShelfTabs({
  keys,
  active,
  onPick,
}: {
  keys: ShelfKey[];
  active: ShelfKey;
  onPick: (k: ShelfKey) => void;
}) {
  return (
    <div className="ms-shelves" role="tablist" aria-label="Shelves">
      {keys.map((k) => (
        <button
          type="button"
          role="tab"
          key={k}
          aria-selected={k === active}
          className={`ms-shelf-tab${k === active ? ' is-on' : ''}`}
          onClick={() => onPick(k)}
        >
          {SHELF_LABELS[k]}
        </button>
      ))}
    </div>
  );
}
