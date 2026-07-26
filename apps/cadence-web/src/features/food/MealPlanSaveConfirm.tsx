/**
 * Confirm-first save for a generated meal-plan draft. Nothing is saved until Confirm.
 */
import { useState } from 'react';
import {
  mealPlanDayLabel,
  saveMealPlan,
  shoppingListSummary,
  type MealPlanDraft,
  type MealPlanRecord,
} from '../../lib/api.ts';

export function MealPlanSaveConfirm({
  draft,
  onCancel,
  onSaved,
}: {
  draft: MealPlanDraft;
  onCancel: () => void;
  onSaved: (plan: MealPlanRecord) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const result = await saveMealPlan(draft);
      if (result.status !== 'ok') {
        setErr(result.message);
        return;
      }
      onSaved(result.plan);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="food-confirm" role="region" aria-label="Confirm meal plan save">
      <div className="food-panel-t">Here&apos;s the week I drafted — keep it?</div>
      <p className="food-panel-p">
        Nothing is saved until you confirm. Glance the days and shopping list — if something&apos;s off, cancel and we
        can try again with a clearer note.
      </p>

      <p className="food-panel-p" style={{ marginBottom: 8 }}>
        Week of <b>{draft.week_of}</b>
        {draft.notes ? ` · “${draft.notes}”` : ''}
        {draft.filtered_allergy ? ` · skipped ${draft.filtered_allergy} allergy-flagged idea(s)` : ''}
      </p>

      {draft.days.length > 0 && (
        <ul className="food-recipe-ing-list" aria-label="Draft days">
          {draft.days.map((d) => (
            <li key={d.day}>
              <b>{mealPlanDayLabel(d.day)}</b>
              {' — '}
              {d.meals.map((m) => `${m.slot}: ${m.recipe.name}`).join('; ')}
            </li>
          ))}
        </ul>
      )}

      <p className="food-panel-p" style={{ marginTop: 10 }}>
        {shoppingListSummary(draft.shopping_list)}
      </p>

      {err && <div className="food-empty">{err}</div>}

      <div className="food-confirm-actions">
        <button type="button" className="lockbtn" disabled={busy} onClick={() => void confirm()}>
          {busy ? 'Saving…' : 'Yes, keep this week'}
        </button>
        <button type="button" className="lockbtn ghost" disabled={busy} onClick={onCancel}>
          Not yet
        </button>
      </div>
    </div>
  );
}
