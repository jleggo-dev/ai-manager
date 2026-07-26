/**
 * Draft a week + shopping list via POST /nutrition/meal-plans/generate.
 * Output is a draft — parent shows confirm-before-save.
 */
import { useState } from 'react';
import { generateMealPlan, weekOfMonday, type MealPlanDraft } from '../../lib/api.ts';

export function MealPlanGeneratePanel({
  onDraft,
  onCancel,
}: {
  onDraft: (draft: MealPlanDraft) => void;
  onCancel: () => void;
}) {
  const [prefs, setPrefs] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const weekOf = weekOfMonday();

  async function run() {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const result = await generateMealPlan({
        week_of: weekOf,
        ...(prefs.trim() ? { prefs: prefs.trim() } : {}),
      });
      if (result.status !== 'ok') {
        setErr(result.message);
        return;
      }
      onDraft(result.draft);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="food-panel" role="region" aria-label="Draft a week of meals">
      <div className="food-panel-t">Plan this week</div>
      <p className="food-panel-p">
        I&apos;ll draft meals around your targets and what you already like — plus a shopping list. Nothing sticks until
        you say this week looks right.
      </p>
      <p className="food-panel-p" style={{ marginBottom: 8 }}>
        Week of <b>{weekOf}</b>
      </p>

      <label className="food-field">
        <span>Anything I should work around?</span>
        <textarea
          className="wiz-in"
          rows={3}
          value={prefs}
          disabled={busy}
          placeholder="Busy Wednesdays, more fish, use the chili we saved…"
          onChange={(e) => setPrefs(e.target.value)}
        />
      </label>

      {err && <div className="food-empty">{err}</div>}

      <div className="food-confirm-actions">
        <button type="button" className="lockbtn" disabled={busy} onClick={() => void run()}>
          {busy ? 'Drafting…' : 'Draft the week'}
        </button>
        <button type="button" className="lockbtn ghost" disabled={busy} onClick={onCancel}>
          Back
        </button>
      </div>
    </div>
  );
}
