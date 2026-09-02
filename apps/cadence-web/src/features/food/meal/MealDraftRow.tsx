/**
 * One row of the open meal (canvas 1b B2) — the MealAmountRows idiom, re-pointed at the draft:
 * the stepper and the × talk to the server through useMealDraft instead of local card state.
 *
 * Two shapes, same rule as design 05c: an amount we hold is kept and steppable; an amount
 * nobody has given is asked as chips, never a keypad — and that one open question is what
 * holds the close. Provenance tags (ASSUMED / SEARCHED / SCANNED / HEARD / TYPED) are
 * display-only, from the door the item came through.
 */
import { useState } from 'react';
import type { MealItem } from '@cadence/shared';
import { fmtKcal, macroLine } from '../bracket/copy.ts';
import { draftAmountChips } from './draftChips.ts';
import type { DoorTag } from './useMealDraft.ts';

const round2 = (n: number): number => Math.round(n * 100) / 100;

function KeptRow({
  item,
  index,
  tag,
  busy,
  onQty,
  onRemove,
}: {
  item: MealItem;
  index: number;
  tag?: DoorTag;
  busy?: boolean;
  onQty: (i: number, q: number) => void;
  onRemove: (i: number) => void;
}) {
  const qty = item.qty ?? 1;
  const sub = [
    typeof item.est?.kcal === 'number' ? `${fmtKcal(item.est.kcal)} kcal` : null,
    macroLine(item.est) || null,
    item.brand || null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="fa-row ms-row">
      <div className="fa-row-t">
        <span className="fa-row-n">
          <b>{item.name}</b>
          {tag && <span className="ms-tag">{tag.toUpperCase()}</span>}
        </span>
        {sub && <span className="ms-row-sub">{sub}</span>}
      </div>
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
        <button type="button" aria-label={`More ${item.name}`} disabled={busy} onClick={() => onQty(index, round2(qty + 0.25))}>
          +
        </button>
      </div>
      <button
        type="button"
        className="fa-row-x"
        aria-label={`Remove ${item.name}`}
        disabled={busy}
        onClick={() => onRemove(index)}
      >
        ×
      </button>
    </div>
  );
}

function AskedRow({
  item,
  index,
  busy,
  onQty,
}: {
  item: MealItem;
  index: number;
  busy?: boolean;
  onQty: (i: number, q: number) => void;
}) {
  const [own, setOwn] = useState('');
  const [showOwn, setShowOwn] = useState(false);
  const choices = draftAmountChips(item);
  return (
    <div className="fa-row fa-row-ask ms-row">
      <div className="fa-row-t">
        <span className="fa-row-n">
          <b>{item.name}</b>
        </span>
        <span className="fa-ask">how much?</span>
      </div>
      <div className="fa-chips">
        {choices.map((c) => (
          <button type="button" key={c.label} className="fa-chip" disabled={busy} onClick={() => onQty(index, c.qty)}>
            {c.label}
          </button>
        ))}
        <button type="button" className="fa-chip" disabled={busy} onClick={() => setShowOwn((v) => !v)}>
          Another amount
        </button>
      </div>
      {showOwn && (
        <div className="fa-own">
          <input
            className="wiz-in"
            inputMode="decimal"
            value={own}
            placeholder={`how many ${item.unit || 'of them'}?`}
            aria-label={`Amount of ${item.name}`}
            disabled={busy}
            onChange={(e) => setOwn(e.target.value)}
          />
          <button
            type="button"
            className="fa-chip"
            disabled={busy || !(Number(own) > 0)}
            onClick={() => onQty(index, Number(own))}
          >
            That&apos;s it
          </button>
        </div>
      )}
    </div>
  );
}

/** The renderRow the meal's BracketList injects — asked when the qty is still open, else kept. */
export function MealDraftRow(props: {
  item: MealItem;
  index: number;
  tag?: DoorTag;
  busy?: boolean;
  onQty: (i: number, q: number) => void;
  onRemove: (i: number) => void;
}) {
  return props.item.qty == null ? <AskedRow {...props} /> : <KeptRow {...props} />;
}
