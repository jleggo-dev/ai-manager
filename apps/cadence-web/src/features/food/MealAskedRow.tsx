import { useState } from 'react';
import { amountChoices } from './amounts.ts';
import { MealQuestionChoices } from './MealQuestionChoices.tsx';
import type { AmountRow } from './useMealAmounts.ts';

/** The amount nobody has given — asked as chips, never as a keypad (design 05c). */
function AmountChips({
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
    <>
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
    </>
  );
}

/**
 * The row nobody has settled yet, asked in her words. Which answers it offers is a router, and
 * table-tested (MealAskedRow.test.tsx): a question WITH choices offers them as buttons and never
 * the amount chips — an amount cannot answer "whole or skim?" (FOOD-LOGGING-COACH-LED.md, "chips
 * in her voice"; owner 2026-11-01); a question without choices, or a plain missing amount, offers
 * the amount chips as always. Typing stays open on both. A host that cannot re-read (no
 * `onAnswer`) falls back to the amount chips, so the row is never a dead end.
 */
export function MealAskedRow({
  row,
  index,
  busy,
  onQty,
  onAnswer,
}: {
  row: AmountRow;
  index: number;
  busy?: boolean;
  onQty: (i: number, q: number, unit?: string) => void;
  /** Her question answered — a tapped choice (`chosen`) or a typed line. Resolves false on failure. */
  onAnswer?: (i: number, answer: string, chosen: boolean) => Promise<boolean>;
}) {
  const choices = row.choices ?? [];
  return (
    <div className="fa-row fa-row-ask">
      <div className="fa-row-t">
        <span className="fa-row-n">
          <b>{row.name}</b>
        </span>
        {/* Her one question, in her words, where there is one; the plain amount question otherwise. */}
        <span className="fa-ask">{row.question ?? 'how much?'}</span>
      </div>
      {choices.length && onAnswer ? (
        <MealQuestionChoices
          name={row.name}
          choices={choices}
          busy={busy}
          onAnswer={(answer, chosen) => onAnswer(index, answer, chosen)}
        />
      ) : (
        <AmountChips row={row} index={index} busy={busy} onQty={onQty} />
      )}
    </div>
  );
}
