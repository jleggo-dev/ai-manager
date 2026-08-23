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
  onEdit,
}: {
  row: AmountRow;
  index: number;
  busy?: boolean;
  onQty: (i: number, q: number) => void;
  onRemove: (i: number) => void;
  onEdit: (i: number) => void;
}) {
  const qty = row.qty ?? 1;
  /**
   * All four macros, not just calories and protein — brief 03.
   *
   * "This incident needed the NUTRIENTS visible too: the numbers were right and the name was
   * wrong, and no arrangement of the current card lets you see that." Scaled to the amount on
   * screen, so what is shown is what will be logged. A dash where we hold no number, never a
   * zero — the same rule as the diary, because it is the same question being asked earlier.
   */
  const scaled = (v: number | null | undefined): string =>
    typeof v === 'number' ? String(Math.round((v * qty) / row.baseQty)) : '—';
  const macros = [
    { k: 'kcal', v: scaled(row.est?.kcal) },
    { k: 'P', v: scaled(row.est?.protein_g) },
    { k: 'C', v: scaled(row.est?.carbs_g) },
    { k: 'F', v: scaled(row.est?.fat_g) },
  ];
  const sub = [qty, row.unit].filter(Boolean).join(' ');
  return (
    <div className="fa-row">
      <div className="fa-row-t">
        <span className="fa-row-n">
          {/* The name is the door: this is where a wrong one gets fixed while the numbers keep
              their place, which is the whole of brief 03. */}
          <button type="button" className="fa-row-name" disabled={busy} onClick={() => onEdit(index)}>
            {row.name}
          </button>
          {row.source === 'assumed' && <span className="fa-tag">ASSUMED</span>}
        </span>
        <span className="fa-row-s">{sub}</span>
      </div>
      <div className="fa-row-macros">
        {macros.map((m) => (
          <span key={m.k} className="fa-row-m">
            <i>{m.k}</i>
            {m.v}
          </span>
        ))}
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
  onEdit,
}: {
  rows: AmountRow[];
  busy?: boolean;
  onQty: (i: number, q: number, unit?: string) => void;
  onRemove: (i: number) => void;
  /** Open the rename/merge editor for one row — brief 03's repairs, before the log. */
  onEdit: (i: number) => void;
}) {
  return (
    <div className="fa-rows">
      {rows.map((row, i) =>
        row.source === 'asked' && row.qty == null ? (
          <AskedRow key={`${row.name}-${i}`} row={row} index={i} busy={busy} onQty={onQty} />
        ) : (
          <KeptRow
            key={`${row.name}-${i}`}
            row={row}
            index={i}
            busy={busy}
            onQty={onQty}
            onRemove={onRemove}
            onEdit={onEdit}
          />
        ),
      )}
    </div>
  );
}
