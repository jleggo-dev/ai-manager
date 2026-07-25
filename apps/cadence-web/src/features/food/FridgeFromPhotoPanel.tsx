/**
 * Req 5 Phase 4 — snap fridge/pantry → review ingredients → pick a recipe draft.
 * Nothing is saved until RecipeSaveConfirm (brand: confirm-before-commit).
 */
import { useState } from 'react';
import {
  generateRecipesFromIngredients,
  parseFridgePhoto,
  recipeMacroHint,
  type FridgeIngredient,
  type RecipeDraft,
} from '../../lib/api.ts';
import { downscalePhoto } from '../plan/occurrence/format.ts';

type Step = 'snap' | 'review' | 'ideas';

export function FridgeFromPhotoPanel({
  onDraft,
  onCancel,
}: {
  onDraft: (draft: RecipeDraft) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<Step>('snap');
  const [photo, setPhoto] = useState<string | null>(null);
  const [hint, setHint] = useState('');
  const [ingredients, setIngredients] = useState<FridgeIngredient[]>([]);
  const [addName, setAddName] = useState('');
  const [mealHint, setMealHint] = useState('');
  const [drafts, setDrafts] = useState<RecipeDraft[]>([]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  async function pickPhoto(file: File | null | undefined) {
    if (!file || busy) return;
    setNote('');
    try {
      setPhoto(await downscalePhoto(file));
    } catch {
      setNote("Couldn't read that photo — try a different one.");
    }
  }

  async function readFridge() {
    if (!photo || busy) return;
    setBusy(true);
    setNote('');
    try {
      const r = await parseFridgePhoto({ photo, hint: hint.trim() || undefined });
      if (r.status !== 'ok') {
        setNote(r.message);
        return;
      }
      if (!r.photo_readable || r.ingredients.length === 0) {
        setNote(
          r.summary
            ? `I couldn't make out clear foods there (${r.summary}). Try a brighter shot, or add a few items by hand below.`
            : "I couldn't make out clear foods in that photo — try a brighter shot, or add a few items by hand below.",
        );
        setIngredients([]);
        setStep('review');
        return;
      }
      setIngredients(r.ingredients);
      setNotes(r.summary);
      setStep('review');
    } finally {
      setBusy(false);
    }
  }

  function removeAt(index: number) {
    setIngredients((prev) => prev.filter((_, i) => i !== index));
  }

  function addIngredient() {
    const name = addName.trim();
    if (!name) return;
    setIngredients((prev) => [...prev, { name: name.slice(0, 80) }].slice(0, 40));
    setAddName('');
  }

  async function suggestRecipes() {
    if (busy || ingredients.length === 0) return;
    setBusy(true);
    setNote('');
    try {
      const r = await generateRecipesFromIngredients({
        ingredients,
        meal_hint: mealHint.trim() || undefined,
      });
      if (r.status !== 'ok') {
        setNote(r.message);
        return;
      }
      setDrafts(r.drafts);
      setNotes(r.notes ?? '');
      if (r.drafts.length === 0) {
        setNote(r.notes || "I couldn't shape a recipe from that list — add a couple more foods and try again.");
        return;
      }
      setStep('ideas');
    } finally {
      setBusy(false);
    }
  }

  if (step === 'ideas') {
    return (
      <div className="food-panel" role="region" aria-label="Recipe ideas from fridge">
        <div className="food-panel-t">Here&apos;s what I&apos;d make</div>
        <p className="food-panel-p">
          Pick one to review — nothing is saved until you confirm. Grounded in what you said is in the fridge.
        </p>
        {notes && <div className="food-banner">{notes}</div>}
        <ul className="food-list">
          {drafts.map((d, i) => {
            const hintLine = recipeMacroHint(d.macros_per_serving);
            return (
              <li key={`${d.name}-${i}`}>
                <button type="button" className="food-row" disabled={busy} onClick={() => onDraft(d)}>
                  <b>{d.name}</b>
                  <span>
                    {d.servings} serving{d.servings === 1 ? '' : 's'}
                    {hintLine ? ` · ${hintLine}/serving` : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="food-confirm-actions">
          <button type="button" className="lockbtn ghost" disabled={busy} onClick={() => setStep('review')}>
            Back to ingredients
          </button>
          <button type="button" className="lockbtn ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (step === 'review') {
    return (
      <div className="food-panel" role="region" aria-label="Review fridge ingredients">
        <div className="food-panel-t">Here&apos;s what I see — edit before I cook up ideas</div>
        <p className="food-panel-p">
          Remove anything I misread, add what I missed. I&apos;ll suggest recipes from this list — you confirm before
          anything is saved.
        </p>
        {notes && <div className="food-banner">{notes}</div>}
        {ingredients.length > 0 ? (
          <ul className="food-recipe-ing-list">
            {ingredients.map((ing, i) => (
              <li key={`${ing.name}-${i}`}>
                {ing.qty != null ? `${ing.qty}${ing.unit ? ` ${ing.unit}` : ''} ` : ''}
                {ing.name}{' '}
                <button
                  type="button"
                  className="lockbtn ghost"
                  style={{ padding: '2px 8px' }}
                  onClick={() => removeAt(i)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="food-empty">No ingredients yet — add a few below.</div>
        )}
        <div className="food-say-row" style={{ marginTop: 10 }}>
          <input
            className="wiz-in food-say-in"
            value={addName}
            disabled={busy}
            placeholder="Add an ingredient"
            onChange={(e) => setAddName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addIngredient();
              }
            }}
          />
          <button type="button" className="lockbtn ghost" disabled={busy || !addName.trim()} onClick={addIngredient}>
            Add
          </button>
        </div>
        <label className="food-field" style={{ marginTop: 10 }}>
          <span>What are you in the mood for? (optional)</span>
          <input
            className="wiz-in"
            value={mealHint}
            disabled={busy}
            placeholder="quick dinner, high protein…"
            onChange={(e) => setMealHint(e.target.value)}
          />
        </label>
        {note && <div className="food-empty">{note}</div>}
        <div className="food-confirm-actions">
          <button
            type="button"
            className="lockbtn"
            disabled={busy || ingredients.length === 0}
            onClick={() => void suggestRecipes()}
          >
            {busy ? 'Cooking up ideas…' : 'Suggest recipes'}
          </button>
          <button
            type="button"
            className="lockbtn ghost"
            disabled={busy}
            onClick={() => {
              setStep('snap');
              setNote('');
            }}
          >
            Retake photo
          </button>
          <button type="button" className="lockbtn ghost" disabled={busy} onClick={onCancel}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="food-panel" role="region" aria-label="Snap fridge or pantry">
      <div className="food-panel-t">Snap the fridge</div>
      <p className="food-panel-p">
        Show me what you have — I&apos;ll list the foods I can see, you tidy the list, then I&apos;ll draft a few recipe
        ideas. Nothing is saved until you say so.
      </p>
      <label className="food-field">
        <span>Note (optional)</span>
        <input
          className="wiz-in"
          value={hint}
          disabled={busy}
          placeholder="leftover chicken on the second shelf"
          onChange={(e) => setHint(e.target.value)}
        />
      </label>
      <div className="food-snap-actions">
        <label className={`food-snap-pick${busy ? ' food-snap-disabled' : ''}`}>
          Take or choose photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            disabled={busy}
            onChange={(e) => {
              void pickPhoto(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {photo && (
        <div className="photo-preview food-snap-preview">
          <img src={photo} alt="fridge or pantry" />
          <button
            type="button"
            className="photo-clear"
            disabled={busy}
            aria-label="Remove fridge photo"
            onClick={() => setPhoto(null)}
          >
            ×
          </button>
        </div>
      )}
      {note && <div className="food-empty">{note}</div>}
      <div className="food-confirm-actions">
        <button type="button" className="lockbtn" disabled={busy || !photo} onClick={() => void readFridge()}>
          {busy ? 'Reading fridge…' : 'Read what I have'}
        </button>
        <button type="button" className="lockbtn ghost" disabled={busy} onClick={onCancel}>
          Back
        </button>
      </div>
    </div>
  );
}
