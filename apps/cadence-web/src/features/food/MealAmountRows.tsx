import { useState } from 'react';
import { amountChoices } from './amounts.ts';
import type { AmountRow } from './useMealAmounts.ts';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The amount they gave, or the one Cadence supplied — either way it is kept, and steppable. */
function KeptRow({
  row,
  index,
  busy,
  onQty,
  onRemove,
}: {
  row: AmountRow;
  index: number;
  busy?: boolean;
  onQty: (i: number, q: number) => void;
  onRemove: (i: number) => void;
}) {
  const qty = row.qty ?? 1;
  const sub = [
    [qty, row.unit].filter(Boolean).join(' '),
    row.est?.kcal != null ? `${Math.round((row.est.kcal * qty) / row.baseQty)} kcal` : '',
    row.est?.protein_g != null ? `${Math.round((row.est.protein_g * qty) / row.baseQty)}g protein` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="fa-row">
      <div className="fa-row-t">
        <span className="fa-row-n">
          <b>{row.name}</b>
          {row.source === 'assumed' && <span className="fa-tag">ASSUMED</span>}
        </span>
        <span className="fa-row-s">{sub}</span>
      </div>
      <div className="fa-step">
        <button
          type="button"
          aria-label={`Less ${row.name}`}
          disabled={busy || qty <= 0.25}
          onClick={() => onQty(index, Math.max(0.25, round2(qty - 0.25)))}
        >
          −
        </button>
        <b>{qty}</b>
        <button
          type="button"
          aria-label={`More ${row.name}`}
          disabled={busy}
          onClick={() => onQty(index, round2(qty + 0.25))}
        >
          +
        </button>
      </div>
      <button
        type="button"
        className="fa-row-x"
        aria-label={`Remove ${row.name}`}
        disabled={busy}
        onClick={() => onRemove(index)}
      >
        ×
      </button>
    </div>
  );
}

/** The one amount nobody has given — asked as chips, never as a keypad. */
function AskedRow({
  row,
  index,
  busy,
  onQty,
}: {
  row: AmountRow;
  index: number;
  busy?: boolean;
  onQty: (i: number, q: number, unit?: string) => void;
}) {
  const [own, setOwn] = useState('');
  const [showOwn, setShowOwn] = useState(false);
  const choices = amountChoices(row);
  return (
    <div className="fa-row fa-row-ask">
      <div className="fa-row-t">
        <span className="fa-row-n">
          <b>{row.name}</b>
        </span>
        <span className="fa-ask">how much?</span>
      </div>
      <div className="fa-chips">
        {choices.map((c) => (
          <button
            type="button"
            key={c.label}
            className={`fa-chip${row.qty === c.qty && row.unit === c.unit ? ' is-on' : ''}`}
            disabled={busy}
            onClick={() => onQty(index, c.qty, c.unit)}
          >
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
            placeholder={`how many ${row.unit || 'of them'}?`}
            aria-label={`Amount of ${row.name}`}
            disabled={busy}
            onChange={(e) => setOwn(e.target.value)}
          />
          <button
            type="button"
            className="fa-chip"
            disabled={busy || !(Number(own) > 0)}
            onClick={() => onQty(index, Number(own), row.unit)}
          >
            That&apos;s it
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The rule, drawn (design 05c): an amount they said is kept, an amount they didn't is asked for.
 * One thing assumed, one thing asked — never both guessed.
 */
export function MealAmountRows({
  rows,
  busy,
  onQty,
  onRemove,
}: {
  rows: AmountRow[];
  busy?: boolean;
  onQty: (i: number, q: number, unit?: string) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div className="fa-rows">
      {rows.map((row, i) =>
        row.source === 'asked' && row.qty == null ? (
          <AskedRow key={`${row.name}-${i}`} row={row} index={i} busy={busy} onQty={onQty} />
        ) : (
          <KeptRow key={`${row.name}-${i}`} row={row} index={i} busy={busy} onQty={onQty} onRemove={onRemove} />
        ),
      )}
    </div>
  );
}
