/**
 * The strip — "added is not logged" made visible (canvas turn-3 B1/B2). Items land in the open
 * meal; the meal is what commits, so the strip's exact phrase is "not counted yet". Undo lives
 * here (pull the last add straight back out), and what is in the cart rides as chips with an ×.
 *
 * An empty draft draws NO strip. It has nothing to report — "0 things", a disabled Undo, and a
 * Done that goes where ‹ already goes — while costing the height the search field needs with the
 * keyboard up (owner, 2026-09-06: "isn't it a bit like a shopping cart… esp. since I have to be
 * able to add multiple items"). The cart shows up once there is something in it.
 *
 * Two shapes (owner, 2026-09-08: "when the keyboard is up, it's still very difficult to see
 * what's happening — the Done panel takes up far too much space"):
 *   • full — count, kcal, Undo, the chips, and Done; drawn when the keyboard is down;
 *   • compact — ONE line: "2 things · 76 kcal" and Undo. No chips, no Done — the
 *     keyboard's own ✓ is the way to finish typing, and the full cart is back the moment it goes.
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
  logged = false,
  chips,
  more = 0,
  compact = false,
  busy,
  onUndo,
  onRemove,
  doneLabel,
  onDone,
}: {
  mealLabel: string;
  count: number;
  kcal: number | undefined;
  /** A logged meal counts its adds as they land (the cart ruling, 2026-09-07) — say so. */
  logged?: boolean;
  /** What is in the cart, newest last (the caller caps the list). */
  chips?: StripChip[];
  /** How many more are in the cart than the chips show — "+2 more". */
  more?: number;
  /** The keyboard is up: one line, no chips, no Done. */
  compact?: boolean;
  busy?: boolean;
  onUndo: () => void;
  onRemove?: (index: number) => void;
  /** "Done · back to breakfast" — only the add panel draws it. */
  doneLabel?: string;
  onDone?: () => void;
}) {
  if (count === 0) return null;
  const label = mealLabel.charAt(0).toUpperCase() + mealLabel.slice(1);
  const things = `${count} ${count === 1 ? 'thing' : 'things'}`;
  const counted = logged ? 'counted' : 'not counted yet';
  return (
    <div className={`ms-strip${compact ? ' ms-strip--compact' : ''}`}>
      <div className="ms-strip-line">
        {/* The count and the kcal stack, with Undo beside them — canvas B2's shape. Left as three
            siblings in one wrapping row, the pill dropped to a line of its own on a phone and
            took another 13px off the list underneath. */}
        <div className="ms-strip-sum">
          {compact ? (
            // The panel's own title already says which meal — the line is the count and the number.
            <b>{`${things} · ${fmtKcal(kcal)} kcal`}</b>
          ) : (
            <>
              <b>{`${label} · ${things}`}</b>
              <span>{`${fmtKcal(kcal)} kcal · ${counted}`}</span>
            </>
          )}
        </div>
        <button type="button" className="ms-strip-undo" disabled={busy || count === 0} onClick={onUndo}>
          Undo last
        </button>
      </div>
      {!compact && chips && chips.length > 0 && (
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
          {more > 0 && <span className="ms-strip-chip ms-strip-chip--more">{`+${more} more`}</span>}
        </div>
      )}
      {!compact && doneLabel && onDone && (
        <button type="button" className="ms-strip-done" disabled={busy} onClick={onDone}>
          {doneLabel}
        </button>
      )}
    </div>
  );
}
