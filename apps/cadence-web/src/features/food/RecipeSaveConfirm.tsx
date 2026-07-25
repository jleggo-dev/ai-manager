/**
 * Confirm-first save for a from-chat recipe draft. Nothing is saved until Confirm.
 */
import { useState } from 'react';
import { assessDietarySafety, type DietaryProfile, type Recipe } from '@cadence/shared';
import { recipeMacroHint, saveRecipe, type RecipeDraft } from '../../lib/api.ts';

export function RecipeSaveConfirm({
  draft: initial,
  dietary,
  onCancel,
  onSaved,
}: {
  draft: RecipeDraft;
  dietary?: DietaryProfile | null;
  onCancel: () => void;
  onSaved: (recipe: Recipe) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [servings, setServings] = useState(initial.servings);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [allergyOverride, setAllergyOverride] = useState(false);

  const preview = recipeMacroHint(initial.macros_per_serving);
  const safetyTerms = [name, ...initial.ingredients.map((i) => i.name), ...initial.tags];
  const safety = dietary ? assessDietarySafety(dietary, safetyTerms) : { safe: true, flags: [] };
  const allergyFlags = safety.flags.filter((f) => f.severity === 'allergy');

  async function confirm(opts?: { ignoreAllergy?: boolean }) {
    if (busy) return;
    if (!name.trim()) {
      setErr('Give it a name so I can find it next time.');
      return;
    }
    if (allergyFlags.length && !opts?.ignoreAllergy && !allergyOverride) {
      setErr(
        `Heads up — this may include ${allergyFlags.map((f) => f.term).join(', ')}. Edit, cancel, or confirm you still want it saved.`,
      );
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const result = await saveRecipe({
        ...initial,
        name: name.trim(),
        servings: Math.max(1, Math.round(servings)),
        saved: true,
      });
      if (result.status !== 'ok') {
        setErr(result.message);
        return;
      }
      onSaved(result.recipe);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="food-confirm" role="region" aria-label="Confirm recipe save">
      <div className="food-panel-t">Here&apos;s the recipe I drafted — save it?</div>
      <p className="food-panel-p">
        Nothing is saved until you confirm. Tweak the name or servings if I missed something — macros are per serving
        from the ingredients.
      </p>

      <label className="food-field">
        <span>Name</span>
        <input className="wiz-in" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
      </label>

      <label className="food-field">
        <span>Batch servings</span>
        <input
          className="wiz-in"
          type="number"
          min={1}
          step={1}
          value={servings}
          disabled={busy}
          onChange={(e) => {
            const n = Number(e.target.value);
            setServings(Number.isFinite(n) && n > 0 ? n : 1);
          }}
        />
      </label>

      {initial.ingredients.length > 0 && (
        <div className="food-recipe-ings" aria-label="Ingredients">
          <div className="food-panel-t" style={{ fontSize: 13.5 }}>
            Ingredients
          </div>
          <ul className="food-recipe-ing-list">
            {initial.ingredients.map((ing, i) => (
              <li key={`${ing.name}-${i}`}>
                {ing.qty}
                {ing.unit ? ` ${ing.unit}` : ''} {ing.name}
                {!ing.food_id ? ' · estimated' : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview && <div className="food-macro-preview">Per serving: {preview}</div>}
      {allergyFlags.length > 0 && (
        <div className="food-allergy-warn" role="alert">
          This may conflict with your allergies ({allergyFlags.map((f) => f.term).join(', ')}). I won&apos;t save it
          unless you say so.
        </div>
      )}
      {err && <div className="food-empty">{err}</div>}

      <div className="food-confirm-actions">
        <button type="button" className="lockbtn" disabled={busy} onClick={() => void confirm()}>
          {busy ? 'Saving…' : 'Looks right — save recipe'}
        </button>
        {allergyFlags.length > 0 && (
          <button
            type="button"
            className="lockbtn ghost"
            disabled={busy}
            onClick={() => {
              setAllergyOverride(true);
              void confirm({ ignoreAllergy: true });
            }}
          >
            Save it anyway — I know
          </button>
        )}
        <button type="button" className="lockbtn ghost" disabled={busy} onClick={onCancel}>
          Back
        </button>
      </div>
    </div>
  );
}
