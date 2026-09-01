import { useState } from 'react';
import { MEAL_KINDS } from '@cadence/shared';
import { logPreviewedMeal, type MealKind, type MealPreview, type PlateAdvice } from '../../lib/api.ts';
import { useInvalidateNutritionDay } from '../../lib/query/index.ts';
import { mealForNow } from '../plan/occurrence/format.ts';
import { macroLineProteinFirst } from './amounts.ts';
import { MealAmountRows } from './MealAmountRows.tsx';
import { MealVendorAsk } from './MealVendorAsk.tsx';
import { MealItemEdit } from './MealItemEdit.tsx';
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
  onLogged: () => void;
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
  const { rows, setQty, setBrand, removeRow, renameRow, mergeRow, asked, total, toPreview } = useMealAmounts(preview);
  const [editing, setEditing] = useState<number | null>(null);

  async function confirm() {
    if (busy || asked > 0 || !rows.length) return;
    setBusy(true);
    setErr('');
    try {
      await logPreviewedMeal(toPreview(), meal);
      await invalidateNutritionDay();
      onLogged();
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
        {asked > 0 && (
          <span className="fa-card-open">
            {asked} AMOUNT{asked === 1 ? '' : 'S'} TO SETTLE
          </span>
        )}
      </div>

      <MealAmountRows rows={rows} busy={busy} onQty={setQty} onRemove={removeRow} onEdit={setEditing} />

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
        <button type="button" className="fa-log" disabled={busy || asked > 0} onClick={() => void confirm()}>
          {busy
            ? 'Writing it down…'
            : asked === 1
              ? 'One amount to settle first'
              : asked > 1
                ? `${asked} amounts to settle first`
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
