/**
 * The cart, pinned at the bottom (quick log, 2026-10-28): one chip per thing in the meal —
 * a bracket is one chip, a doubled row says "2×" — each with its ×, and one button:
 * "Log breakfast · 412 kcal". A loose chip's words open the row (the amount, the macros, the
 * way out) so an amount the chat door left unsettled can still be settled from here; the
 * button waits on exactly that, as the old footer did.
 *
 * Nothing shows while the cart is empty — the shelf has the room. Once the meal is logged the
 * chips stay (adds still land and count) and the button is the way out.
 */
import type { Macros, MealKind } from '@cadence/shared';
import { fmtKcal } from '../bracket/copy.ts';
import type { CartChip } from './cartModel.ts';

export function CartBar({
  kind,
  chips,
  total,
  askedCount,
  logged,
  busy,
  onOpenChip,
  onRemoveChip,
  onLog,
  onDone,
}: {
  kind: MealKind;
  chips: CartChip[];
  total: Macros;
  askedCount: number;
  logged: boolean;
  busy?: boolean;
  onOpenChip: (chip: CartChip) => void;
  onRemoveChip: (chip: CartChip) => void;
  onLog: () => void;
  onDone: () => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="ms-cart">
      <div className="ms-cart-chips">
        {chips.map((c) => (
          <span className="ms-cart-chip" key={c.key}>
            {c.loose ? (
              <button type="button" className="ms-cart-chip-w" onClick={() => onOpenChip(c)}>
                {c.label}
              </button>
            ) : (
              <span className="ms-cart-chip-w">{c.label}</span>
            )}
            <button
              type="button"
              className="ms-cart-chip-x"
              aria-label={`Take out ${c.label}`}
              disabled={busy}
              onClick={() => onRemoveChip(c)}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {askedCount > 0 && !logged && (
        <div className="ms-settle">
          {askedCount === 1
            ? 'One amount to settle first — tap its chip'
            : `${askedCount} amounts to settle first — tap their chips`}
        </div>
      )}
      {logged ? (
        <button type="button" className="ms-log" disabled={busy} onClick={onDone}>
          Done
        </button>
      ) : (
        <button type="button" className="ms-log" disabled={busy || askedCount > 0} onClick={onLog}>
          {busy ? 'Logging…' : `Log ${kind} · ${fmtKcal(total.kcal)} kcal`}
        </button>
      )}
    </div>
  );
}
