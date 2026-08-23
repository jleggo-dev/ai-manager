import { useState } from 'react';
import type { AmountRow } from './useMealAmounts.ts';
import { GrowingTextarea } from '../../components/GrowingTextarea.tsx';

/**
 * Repairing one item BEFORE it is logged — brief 03.
 *
 * The same two moves the logged-meal sheet offers, arriving one step earlier, because this is the
 * moment they are free. After the log a food nothing matched is pinned as a permanent private row,
 * so a bad name stops being one wrong meal and becomes one that resolves again tomorrow. The brief
 * calls the confirm "the last honest moment" and means it literally.
 *
 * Both moves keep the numbers. That is the whole lesson of the incident that produced this screen:
 * 591 kcal and 50.7 g fat per 100 g were very nearly right for peanuts, under a name that was
 * wrong. A correction that discarded the nutrition to fix the label would throw away the good half.
 */
export function MealItemEdit({
  row,
  index,
  siblings,
  busy,
  onRename,
  onMerge,
  onClose,
}: {
  row: AmountRow;
  index: number;
  /** The other rows on this meal — what "these are the same thing" can point at. */
  siblings: Array<{ row: AmountRow; index: number }>;
  busy?: boolean;
  onRename: (i: number, name: string, brand?: string | null) => void;
  onMerge: (from: number, into: number) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(row.name);
  const [brand, setBrand] = useState(row.brand ?? '');
  const [merging, setMerging] = useState(false);

  if (merging) {
    return (
      <div className="fa-edit">
        <p className="fa-edit-note">I’ll add this one’s nutrition to whichever you pick, and drop this row.</p>
        {siblings.map(({ row: s, index: j }) => (
          <button key={j} type="button" className="fa-chip" disabled={busy} onClick={() => onMerge(index, j)}>
            {s.name}
          </button>
        ))}
        <button type="button" className="fa-chip" disabled={busy} onClick={() => setMerging(false)}>
          Never mind
        </button>
      </div>
    );
  }

  return (
    <div className="fa-edit">
      <p className="fa-edit-note">The numbers stay as they are — this only changes what it’s called.</p>
      <GrowingTextarea
        className="wiz-in"
        value={name}
        onChange={setName}
        disabled={busy}
        ariaLabel={`What ${row.name} really was`}
        placeholder="dill pickle peanuts"
      />
      <input
        className="wiz-in"
        value={brand}
        disabled={busy}
        aria-label={`Where ${row.name} came from`}
        placeholder="where it came from — “Couche-Tard”"
        onChange={(e) => setBrand(e.target.value)}
      />
      <div className="fa-edit-acts">
        <button
          type="button"
          className="fa-chip is-on"
          disabled={busy || !name.trim()}
          onClick={() => {
            onRename(index, name, brand.trim() || null);
            onClose();
          }}
        >
          That’s it
        </button>
        {siblings.length > 0 && (
          <button type="button" className="fa-chip" disabled={busy} onClick={() => setMerging(true)}>
            Same as another
          </button>
        )}
        <button type="button" className="fa-chip" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
