/**
 * The strip — "added is not logged" made visible (canvas turn-3 B1/B2). Items land in the open
 * meal; the meal is what commits, so the strip's exact phrase is "not counted yet". Undo lives
 * here (pull the last add straight back out), and the last few adds ride as chips with an ×.
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
  const label = mealLabel.charAt(0).toUpperCase() + mealLabel.slice(1);
  return (
    <div className="ms-strip">
      <div className="ms-strip-line">
        <b>{`${label} · ${count} ${count === 1 ? 'thing' : 'things'}`}</b>
        <span>{`${fmtKcal(kcal)} kcal · not counted yet`}</span>
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
