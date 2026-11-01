import { useState } from 'react';
import { MEAL_KINDS } from '@cadence/shared';
import { logPreviewedMeal, type Meal, type MealKind, type MealPreview, type PlateAdvice } from '../../lib/api.ts';
import { useInvalidateNutritionDay } from '../../lib/query/index.ts';
import { mealForNow } from '../plan/occurrence/format.ts';
import { macroLineProteinFirst } from './amounts.ts';
import { MealAmountRows } from './MealAmountRows.tsx';
import { MealVendorAsk } from './MealVendorAsk.tsx';
import { MealItemEdit } from './MealItemEdit.tsx';
import { settleButton, settleChip } from './settleWords.ts';
import { useMealAmounts } from './useMealAmounts.ts';

const countLine = (n: number): string =>
  n === 1 ? 'One thing' : n === 2 ? 'Two things' : n === 3 ? 'Three things' : `${n} things`;

/**
 * "Here's my read — confirm?"
 *
 * The parse-and-confirm card for a described meal, and the place **the amounts rule** lives
 * (design 05c): an amount they gave is KEPT and never re-asked; an amount they didn't give is
 * ASKED for, as chips rather than a keypad. One thing assumed, one thing asked — never both
 * guessed. The rule needs nothing invented: the `parse-meal` job only sets `qty` when an amount
 * was stated or is plainly countable, so an item without one is exactly an open question.
 *
 * What logs is exactly what renders — the card's own contents go back verbatim and the server
 * inserts them with no second AI pass. The escape hatch stays: the meal-vs-single-food split
 * upstream is a heuristic, so "just one food?" hands the same words to the resolver instead.
 */
export function MealParseCard({
  preview,
  initialMeal,
  mode = 'log',
  mealLabel,
  onAppend,
  onLogged,
  onNotAMeal,
  onCancel,
  onAskRead,
  onAddAnother,
  advice,
  advising,
}: {
  preview: MealPreview;
  /** Prefill (the meal task's kind); defaults from the time of day. */
  initialMeal?: MealKind;
  /**
   * Draft mode (meal-logging rework, 1b): the confirm APPENDS into the open meal instead of
   * writing one — rows keep their given/assumed/asked amounts verbatim (appendParsed passes
   * through, never re-parsed), the slot question disappears (the draft owns it), and an asked
   * amount no longer gates the button: its chips wait on the meal screen, where one unsettled
   * amount holds the close instead.
   */
  mode?: 'log' | 'draft';
  /** Draft mode: the open meal's name — the button reads "Add to breakfast". */
  mealLabel?: string;
  /** Draft mode's write: hand the card's contents to the draft. Resolves false on failure. */
  onAppend?: (preview: MealPreview) => Promise<boolean>;
  /** Called with the row that landed; draft mode's add has none to give. */
  onLogged: (logged?: Meal) => void;
  /** "Just one food?" — re-run the same words through the single-food resolver. */
  onNotAMeal?: () => void;
  onCancel: () => void;
  /** Ask for a read BEFORE eating. Absent = the host doesn't offer it here. */
  onAskRead?: () => void;
  /** "I also had…" — back to the composer, keeping this meal open to grow. */
  onAddAnother?: () => void;
  advice?: PlateAdvice | null;
  advising?: boolean;
}) {
  const [meal, setMeal] = useState<MealKind>(() => initialMeal ?? preview.meal ?? mealForNow());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const invalidateNutritionDay = useInvalidateNutritionDay();
  const { rows, setQty, setBrand, removeRow, renameRow, mergeRow, answerRow, asked, askedChoices, total, toPreview } =
    useMealAmounts(preview);
  const [editing, setEditing] = useState<number | null>(null);

  const draft = mode === 'draft' && !!onAppend;

  async function confirm() {
    if (busy || !rows.length || (!draft && asked > 0)) return;
    setBusy(true);
    setErr('');
    try {
      if (draft) {
        // The day cache refreshes when the MEAL closes, not per add — added is not logged.
        const ok = await onAppend!(toPreview());
        if (!ok) setErr("Couldn't write that down just now — try again in a moment.");
        else onLogged();
        return;
      }
      const logged = await logPreviewedMeal(toPreview(), meal);
      await invalidateNutritionDay();
      onLogged(logged);
    } catch {
      setErr("Couldn't write that down just now — try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fa-card" role="region" aria-label="Confirm meal log">
      <div className="fa-card-h">
        <b>{countLine(rows.length)}</b>
        {asked > 0 && <span className="fa-card-open">{settleChip(asked, askedChoices > 0)}</span>}
      </div>

      {/* Her question's answers as buttons: a tap re-reads that part for the slot this card logs to
          (FOOD-LOGGING-COACH-LED.md, "chips in her voice"). */}
      <MealAmountRows
        rows={rows}
        busy={busy}
        onQty={setQty}
        onRemove={removeRow}
        onEdit={setEditing}
        onAnswer={(i, answer, chosen) => answerRow(i, answer, chosen, meal)}
      />

      {/* The last honest moment: after this, an unmatched food is pinned and its name resolves
          again tomorrow. Both repairs keep the nutrition and change only the label. */}
      {editing != null && rows[editing] && (
        <MealItemEdit
          row={rows[editing]}
          index={editing}
          siblings={rows.map((r, i) => ({ row: r, index: i })).filter(({ index: i }) => i !== editing)}
          busy={busy}
          onRename={renameRow}
          onMerge={(from, into) => {
            mergeRow(from, into);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {/* Optional, and deliberately below the numbers: it never gates the log (A23 §1b). */}
      <MealVendorAsk rows={rows} busy={busy} onBrand={setBrand} />

      <div className="fa-tot">
        <b>~{Math.round(total.kcal ?? 0)} kcal</b>
        <span>{macroLineProteinFirst(total)}</span>
      </div>

      {!draft && (
        <label className="food-field">
          <span>Meal</span>
          <select className="wiz-in" value={meal} disabled={busy} onChange={(e) => setMeal(e.target.value as MealKind)}>
            {MEAL_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* The same read the camera path has always offered, on the typed path at last: it lived
          only inside the photo branch, so describing your meal instead of photographing it meant
          the advice simply did not exist for you (owner, 2026-08-15). */}
      {advice ? (
        <div className={`mc-plate pa-${advice.verdict}`}>
          <div className="mc-plate-k">A READ, NOT A RULING</div>
          <div className="mc-plate-a">{advice.advice}</div>
        </div>
      ) : (
        onAskRead && (
          <button type="button" className="mc-plate-ask" disabled={advising || busy} onClick={onAskRead}>
            {advising ? 'Looking at it…' : 'Want a read before you eat? ›'}
          </button>
        )
      )}

      {err && <div className="food-empty">{err}</div>}

      <div className="food-confirm-actions">
        <button
          type="button"
          className="fa-log"
          disabled={busy || (!draft && asked > 0)}
          onClick={() => void confirm()}
        >
          {busy
            ? 'Writing it down…'
            : draft
              ? `Add to ${mealLabel ?? meal}`
              : asked > 0
                ? settleButton(asked, askedChoices > 0)
                : `Log to ${meal}`}
        </button>
        {onAddAnother && (
          <button type="button" className="mc-addanother" disabled={busy} onClick={onAddAnother}>
            ＋ Add something I forgot
          </button>
        )}
        {onNotAMeal && (
          <button type="button" className="lockbtn ghost" disabled={busy} onClick={onNotAMeal}>
            Not a meal — one food
          </button>
        )}
        <button type="button" className="lockbtn ghost" disabled={busy} onClick={onCancel}>
          Back
        </button>
      </div>
    </div>
  );
}
