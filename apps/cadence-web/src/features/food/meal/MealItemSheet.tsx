/**
 * One thing in the meal, opened (owner, 2026-09-07: "I should be able to click and easily see
 * everything I've added for breakfast and dig into the details"). The row already shows the
 * name, the amount and a kcal figure; this is the rest — the macro card, the brand, where it
 * came through, the amount as a stepper, and the way to take it out. Nothing here writes
 * anything the row could not: it is the same setAmount / removeItem, drawn larger.
 */
import type { MealItem } from '@cadence/shared';
import { FoodMacroCard } from '../FoodMacroCard.tsx';
import type { DoorTag } from './useDraftCore.ts';

const round2 = (n: number): number => Math.round(n * 100) / 100;

const TAG_WORDS: Record<DoorTag, string> = {
  searched: 'found in the list',
  scanned: 'scanned off the packet',
  heard: 'heard',
  typed: 'typed',
  assumed: 'amount assumed',
};

export function MealItemSheet({
  item,
  index,
  tag,
  busy,
  onQty,
  onRemove,
  onClose,
}: {
  item: MealItem;
  index: number;
  tag?: DoorTag;
  busy?: boolean;
  onQty: (i: number, q: number) => void;
  onRemove: (i: number) => void;
  onClose: () => void;
}) {
  const qty = item.qty ?? 1;
  const sub = [item.brand, tag ? TAG_WORDS[tag] : null].filter(Boolean).join(' · ');
  return (
    <div className="ms-sheet-backdrop" onClick={onClose}>
      <div className="ms-sheet ms-item" role="dialog" aria-label={item.name} onClick={(e) => e.stopPropagation()}>
        <div className="ms-sheet-grab" aria-hidden="true" />
        <div className="ms-item-head">
          <b>{item.name}</b>
          {sub && <span>{sub}</span>}
        </div>
        <div className="fd-field ms-item-field">
          <span className="fd-field-l">Amount</span>
          <div className="fa-step">
            <button
              type="button"
              aria-label={`Less ${item.name}`}
              disabled={busy || qty <= 0.25}
              onClick={() => onQty(index, Math.max(0.25, round2(qty - 0.25)))}
            >
              −
            </button>
            <b>{[qty, item.unit].filter(Boolean).join(' ')}</b>
            <button
              type="button"
              aria-label={`More ${item.name}`}
              disabled={busy}
              onClick={() => onQty(index, round2(qty + 0.25))}
            >
              +
            </button>
          </div>
        </div>
        <FoodMacroCard macros={item.est ?? {}} />
        <div className="ms-item-actions">
          <button
            type="button"
            className="lockbtn ghost"
            disabled={busy}
            onClick={() => {
              onRemove(index);
              onClose();
            }}
          >
            Take it out
          </button>
          <button type="button" className="fa-log" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
