/**
 * The strip — "added is not logged" made visible (canvas turn-3 B1/B2). Items land in the open
 * meal; the meal is what commits, so the strip's exact phrase is "not counted yet". Undo lives
 * here (pull the last add straight back out), and the last few adds ride as chips with an ×.
 *
 * An empty draft draws NO strip. It has nothing to report — "0 things", a disabled Undo, and a
 * Done that goes where ‹ already goes — while costing the height the search field needs with the
 * keyboard up (owner, 2026-09-06: "isn't it a bit like a shopping cart… esp. since I have to be
 * able to add multiple items"). The cart shows up once there is something in it.
 */
import { fmtKcal } from '../bracket/copy.ts';

export interface StripChip {
  index: number;
  name: string;
}

export function DraftStrip({
  mealLabel,
  count,
  kcal,
  chips,
  busy,
  onUndo,
  onRemove,
  doneLabel,
  onDone,
}: {
  mealLabel: string;
  count: number;
  kcal: number | undefined;
  /** The last few appends, newest last. */
  chips?: StripChip[];
  busy?: boolean;
  onUndo: () => void;
  onRemove?: (index: number) => void;
  /** "Done · back to breakfast" — only the add panel draws it. */
  doneLabel?: string;
  onDone?: () => void;
}) {
  if (count === 0) return null;
  const label = mealLabel.charAt(0).toUpperCase() + mealLabel.slice(1);
  return (
    <div className="ms-strip">
      <div className="ms-strip-line">
        {/* The count and the kcal stack, with Undo beside them — canvas B2's shape. Left as three
            siblings in one wrapping row, the pill dropped to a line of its own on a phone and
            took another 13px off the list underneath. */}
        <div className="ms-strip-sum">
          <b>{`${label} · ${count} ${count === 1 ? 'thing' : 'things'}`}</b>
          <span>{`${fmtKcal(kcal)} kcal · not counted yet`}</span>
        </div>
        <button type="button" className="ms-strip-undo" disabled={busy || count === 0} onClick={onUndo}>
          Undo last
        </button>
      </div>
      {chips && chips.length > 0 && (
        <div className="ms-strip-chips">
          {chips.map((c) => (
            <span key={c.index} className="ms-strip-chip">
              {c.name}
              {onRemove && (
                <button type="button" aria-label={`Remove ${c.name}`} disabled={busy} onClick={() => onRemove(c.index)}>
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {doneLabel && onDone && (
        <button type="button" className="ms-strip-done" disabled={busy} onClick={onDone}>
          {doneLabel}
        </button>
      )}
    </div>
  );
}
