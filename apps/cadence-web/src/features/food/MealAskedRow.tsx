import { useState } from 'react';
import { amountChoices } from './amounts.ts';
import { MealQuestionChoices } from './MealQuestionChoices.tsx';
import { OwnAnswerField } from './OwnAnswerField.tsx';
import { REASKS_MAX, type AnswerResult } from './reReadAnswer.ts';
import type { AmountRow } from './useMealAmounts.ts';

/** Above the question when an answer brought the question back: the person sees that something happened. */
export const STILL_ASKING = "I still couldn't settle that:";
/** When the buttons have been tried REASKS_MAX times: the row asks the amount instead and says why. */
export const COULD_NOT_SETTLE = "I couldn't settle that one — give me an amount and I'll take it as written.";

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
        <OwnAnswerField
          label={`Amount of ${row.name}`}
          placeholder={`how many ${row.unit || 'of them'}?`}
          canSend={(t) => Number(t) > 0}
          disabled={busy}
          inputMode="decimal"
          onSend={(t) => onQty(index, Number(t), row.unit)}
        />
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
 * `onAnswer`) falls back to the amount chips, so the row is never a dead end — and so does a row
 * that has come back as a question REASKS_MAX times: it says she could not settle it and asks the
 * amount, which the confirm takes as written.
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
  /** Her question answered — a tapped choice (`chosen`) or a typed line; says what happened. */
  onAnswer?: (i: number, answer: string, chosen: boolean) => Promise<AnswerResult>;
}) {
  const choices = row.choices ?? [];
  const reasks = row.reasks ?? 0;
  const capped = reasks >= REASKS_MAX;
  const buttons = choices.length > 0 && !!onAnswer && !capped;
  return (
    <div className="fa-row fa-row-ask">
      <div className="fa-row-t">
        <span className="fa-row-n">
          <b>{row.name}</b>
        </span>
        {/* Her one question, in her words, where there is one; the plain amount question otherwise.
            A question that came back again says so first, so a tap is never answered by silence. */}
        {buttons && reasks > 0 && <span className="fa-ask fa-ask-again">{STILL_ASKING}</span>}
        <span className="fa-ask">{capped ? COULD_NOT_SETTLE : (row.question ?? 'how much?')}</span>
      </div>
      {buttons ? (
        <MealQuestionChoices
          name={row.name}
          choices={choices}
          busy={busy}
          onAnswer={(answer, chosen) => onAnswer!(index, answer, chosen)}
        />
      ) : (
        <AmountChips row={row} index={index} busy={busy} onQty={onQty} />
      )}
    </div>
  );
}
