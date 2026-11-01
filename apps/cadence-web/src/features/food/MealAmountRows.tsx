import { MealAskedRow } from './MealAskedRow.tsx';
import type { AnswerResult } from './reReadAnswer.ts';
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
    // Spelled out, never P/C/F (owner, 2026-09-08).
    { k: 'protein', v: scaled(row.est?.protein_g) },
    { k: 'carbs', v: scaled(row.est?.carbs_g) },
    { k: 'fat', v: scaled(row.est?.fat_g) },
  ];
  // The amount, then — for a row the automatic estimate priced because the coach could not be
  // reached — its label, then what the coach assumed where the words left something open, then
  // her question if the row still carries one — shown on the row, never hidden in a number
  // (FOOD-LOGGING-COACH-LED.md). A question row normally has no amount and renders as MealAskedRow;
  // one that arrives with an amount anyway still shows the question rather than losing it.
  const sub = [
    [qty, row.unit].filter(Boolean).join(' '),
    row.basis === 'fallback' ? row.source_label : '',
    row.assumption,
    row.question,
  ]
    .filter(Boolean)
    .join(' · ');
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
        {/* Under the name, not beside it: as a sibling in the row the strip took the middle and
            squeezed the name, amount and her note into a one-word column (2026-11-01, photo read
            of a spanakopita — the long assumption made it visible). */}
        <div className="fa-row-macros">
          {macros.map((m) => (
            <span key={m.k} className="fa-row-m">
              <i>{m.k}</i>
              {m.v}
            </span>
          ))}
        </div>
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

/**
 * The rule, drawn (design 05c): an amount they said is kept, an amount they didn't is asked for.
 * One thing assumed, one thing asked — never both guessed. A row waiting on her question offers
 * her answers as buttons (MealAskedRow → MealQuestionChoices) when the host can re-read it.
 */
export function MealAmountRows({
  rows,
  busy,
  onQty,
  onRemove,
  onEdit,
  onAnswer,
}: {
  rows: AmountRow[];
  busy?: boolean;
  onQty: (i: number, q: number, unit?: string) => void;
  onRemove: (i: number) => void;
  /** Open the rename/merge editor for one row — brief 03's repairs, before the log. */
  onEdit: (i: number) => void;
  /** Her question answered — a tapped choice or a typed line; the host re-reads the part and says what happened. */
  onAnswer?: (i: number, answer: string, chosen: boolean) => Promise<AnswerResult>;
}) {
  return (
    <div className="fa-rows">
      {rows.map((row, i) =>
        row.source === 'asked' && row.qty == null ? (
          <MealAskedRow key={`${row.name}-${i}`} row={row} index={i} busy={busy} onQty={onQty} onAnswer={onAnswer} />
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
