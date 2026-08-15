import { useState } from 'react';
import { logPreviewedMeal, type MealKind, type MealPreview, type PlateAdvice } from '../../lib/api.ts';
import { useInvalidateNutritionDay } from '../../lib/query/index.ts';
import { mealForNow } from '../plan/occurrence/format.ts';

const MEAL_KINDS: MealKind[] = ['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'other'];

/**
 * "Here's how I read that meal — log it?"
 *
 * The confirm card for a multi-ingredient description. Every ingredient is a row with the
 * quantity the user GAVE — there is deliberately no serving-size question anywhere on this card,
 * because "1 cup frozen strawberries, 2/3 cup skyr, 1 scoop protein powder" already answered it:
 * those amounts are the serving (owner, 2026-08-15). The one thing still worth asking is which
 * meal this was, prefilled from the clock.
 *
 * What logs is exactly what renders — the preview payload goes back verbatim and the server
 * inserts it with no second AI pass. And the escape hatch matters: the meal-vs-single-food split
 * upstream is a heuristic, so "just one food?" hands the same words to the resolver instead.
 */
export function MealParseCard({
  preview,
  initialMeal,
  onLogged,
  onNotAMeal,
  onCancel,
  onAskRead,
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
  advice?: PlateAdvice | null;
  advising?: boolean;
}) {
  const [meal, setMeal] = useState<MealKind>(() => initialMeal ?? preview.meal ?? mealForNow());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const invalidateNutritionDay = useInvalidateNutritionDay();

  const total = preview.macros;
  const provisional = preview.confidence != null && preview.confidence < 0.5;

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      await logPreviewedMeal(preview, meal);
      await invalidateNutritionDay();
      onLogged();
    } catch {
      setErr("Couldn't write that down just now — try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="food-confirm" role="region" aria-label="Confirm meal log">
      <div className="food-panel-t">Here&apos;s how I read that — log it?</div>
      <p className="food-panel-p">
        Your amounts are the serving sizes. The nutrition is an estimate — close enough to coach from, and I&apos;ll
        adjust as I learn how you eat. Nothing counts until you confirm.
      </p>

      <div className="mealparse-items">
        {preview.items.map((it, i) => (
          <div className="mealparse-item" key={`${it.name}-${i}`}>
            <span className="mealparse-qty">{[it.qty, it.unit].filter((x) => x != null && x !== '').join(' ')}</span>
            <span className="mealparse-name">{it.name}</span>
            {it.est?.kcal != null && <span className="mealparse-kcal">~{Math.round(it.est.kcal)} kcal</span>}
          </div>
        ))}
      </div>

      {total && (
        <div className="food-macro-preview">
          {[
            total.kcal != null ? `~${Math.round(total.kcal)} kcal` : '',
            total.protein_g != null ? `P${Math.round(total.protein_g)}` : '',
            total.carbs_g != null ? `C${Math.round(total.carbs_g)}` : '',
            total.fat_g != null ? `F${Math.round(total.fat_g)}` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
          {provisional ? ' · rough read — tap the meal later to firm it up' : ''}
        </div>
      )}

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
        <button type="button" className="lockbtn" disabled={busy} onClick={() => void confirm()}>
          {busy
            ? 'Writing it down…'
            : `Log it — ${preview.items.length} ingredient${preview.items.length === 1 ? '' : 's'}`}
        </button>
        {onNotAMeal && (
          <button type="button" className="lockbtn ghost" disabled={busy} onClick={onNotAMeal}>
            Just one food? Match it instead
          </button>
        )}
        <button type="button" className="lockbtn ghost" disabled={busy} onClick={onCancel}>
          Back
        </button>
      </div>
    </div>
  );
}
