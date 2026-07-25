/**
 * Thin recipes hub (Req 5 Phase 2 + Phase 4) — list, detail, log-N-servings,
 * structure-from-text, snap-fridge → review → pick draft. Soft-fails warmly when
 * /nutrition/recipes isn't deployed yet.
 */
import { useEffect, useState } from 'react';
import type { DietaryProfile, Recipe } from '@cadence/shared';
import { getRecipeById, listRecipes, recipeMacroHint, type RecipeDraft } from '../../lib/api.ts';
import { FridgeFromPhotoPanel } from './FridgeFromPhotoPanel.tsx';
import { RecipeFromChatPanel } from './RecipeFromChatPanel.tsx';
import { RecipeLogConfirm } from './RecipeLogConfirm.tsx';
import { RecipeSaveConfirm } from './RecipeSaveConfirm.tsx';

type Mode = 'list' | 'detail' | 'log' | 'from-chat' | 'fridge' | 'save';
type DraftReturn = 'from-chat' | 'fridge';

export function RecipesPanel({
  dietary,
  onClose,
  onLogged,
}: {
  dietary?: DietaryProfile | null;
  onClose: () => void;
  onLogged: () => void;
}) {
  const [mode, setMode] = useState<Mode>('list');
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [listStatus, setListStatus] = useState<'loading' | 'ok' | 'empty' | 'unavailable' | 'error'>('loading');
  const [selected, setSelected] = useState<Recipe | null>(null);
  const [draft, setDraft] = useState<RecipeDraft | null>(null);
  const [draftReturn, setDraftReturn] = useState<DraftReturn>('from-chat');
  const [banner, setBanner] = useState('');
  const [pickNote, setPickNote] = useState('');

  function reload() {
    setListStatus('loading');
    listRecipes({ savedOnly: true }).then((r) => {
      if (r.status === 'unavailable') {
        setRecipes([]);
        setListStatus('unavailable');
        return;
      }
      if (r.status === 'error') {
        setRecipes([]);
        setListStatus('error');
        return;
      }
      setRecipes(r.recipes);
      setListStatus(r.recipes.length ? 'ok' : 'empty');
    });
  }

  useEffect(() => {
    let cancelled = false;
    listRecipes({ savedOnly: true }).then((r) => {
      if (cancelled) return;
      if (r.status === 'unavailable') {
        setRecipes([]);
        setListStatus('unavailable');
        return;
      }
      if (r.status === 'error') {
        setRecipes([]);
        setListStatus('error');
        return;
      }
      setRecipes(r.recipes);
      setListStatus(r.recipes.length ? 'ok' : 'empty');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function openRecipe(summary: Recipe) {
    setPickNote('');
    const detail = await getRecipeById(summary.recipe_id);
    if (detail.status !== 'ok' || !detail.recipe) {
      // List row may already have full shape — use it when detail isn't live yet.
      if (summary.ingredients?.length || summary.macros_per_serving) {
        setSelected(summary);
        setMode('detail');
        return;
      }
      setPickNote(
        detail.status === 'unavailable'
          ? "Couldn't load that recipe just now — try again in a moment."
          : "Couldn't open that recipe — try drafting it again from text.",
      );
      return;
    }
    setSelected(detail.recipe);
    setMode('detail');
  }

  if (mode === 'log' && selected) {
    return (
      <RecipeLogConfirm
        recipe={selected}
        dietary={dietary}
        onCancel={() => setMode('detail')}
        onLogged={() => {
          setBanner('Logged — that recipe is on today.');
          setMode('list');
          setSelected(null);
          onLogged();
          reload();
        }}
      />
    );
  }

  if (mode === 'save' && draft) {
    return (
      <RecipeSaveConfirm
        draft={draft}
        dietary={dietary}
        onCancel={() => {
          setDraft(null);
          setMode(draftReturn);
        }}
        onSaved={(recipe) => {
          setDraft(null);
          setSelected(recipe);
          setBanner('Saved — you can log servings any day from here.');
          setMode('detail');
          reload();
        }}
      />
    );
  }

  if (mode === 'fridge') {
    return (
      <FridgeFromPhotoPanel
        onDraft={(d) => {
          setDraft(d);
          setDraftReturn('fridge');
          setMode('save');
        }}
        onCancel={() => setMode('list')}
      />
    );
  }

  if (mode === 'from-chat') {
    return (
      <RecipeFromChatPanel
        onDraft={(d) => {
          setDraft(d);
          setDraftReturn('from-chat');
          setMode('save');
        }}
        onCancel={() => setMode('list')}
      />
    );
  }

  if (mode === 'detail' && selected) {
    const per = recipeMacroHint(selected.macros_per_serving);
    return (
      <div className="food-panel" role="region" aria-label="Recipe detail">
        <div className="food-panel-t">{selected.name}</div>
        <p className="food-panel-p">
          Batch of {selected.servings} serving{selected.servings === 1 ? '' : 's'}
          {per ? ` · ${per} each` : ''}
        </p>
        {selected.ingredients.length > 0 && (
          <ul className="food-recipe-ing-list">
            {selected.ingredients.map((ing, i) => (
              <li key={`${ing.name}-${i}`}>
                {ing.qty}
                {ing.unit ? ` ${ing.unit}` : ''} {ing.name}
              </li>
            ))}
          </ul>
        )}
        {selected.steps.length > 0 && (
          <ol className="food-recipe-steps">
            {selected.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        )}
        <div className="food-confirm-actions">
          <button type="button" className="lockbtn" onClick={() => setMode('log')}>
            Log again
          </button>
          <button
            type="button"
            className="lockbtn ghost"
            onClick={() => {
              setSelected(null);
              setMode('list');
            }}
          >
            Back to recipes
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="food-panel" role="region" aria-label="Your recipes">
      <div className="food-panel-t">Recipes</div>
      <p className="food-panel-p">
        Build once, log servings any day. I draft from your words or a fridge photo — you confirm before anything is
        saved.
      </p>

      {banner && <div className="food-banner">{banner}</div>}
      {pickNote && <div className="food-empty">{pickNote}</div>}

      <button type="button" className="food-action" style={{ marginBottom: 10 }} onClick={() => setMode('fridge')}>
        <b>Snap the fridge</b>
        <span>Photo what you have — review ingredients, then pick a recipe idea</span>
      </button>

      <button type="button" className="food-action" style={{ marginBottom: 10 }} onClick={() => setMode('from-chat')}>
        <b>Structure from text</b>
        <span>Describe a dish — I draft ingredients + per-serving macros</span>
      </button>

      {listStatus === 'loading' && (
        <div className="chat-loading">
          <span className="typing">
            <i />
            <i />
            <i />
          </span>
        </div>
      )}
      {listStatus === 'unavailable' && (
        <div className="food-empty">
          Recipes aren&apos;t live on the server yet — you can still explore this screen. Once the API lands, your saved
          recipes will show up here for two-tap logging.
        </div>
      )}
      {listStatus === 'error' && (
        <div className="food-empty">Couldn&apos;t load recipes just now — try again in a moment.</div>
      )}
      {listStatus === 'empty' && (
        <div className="food-empty">
          Nothing saved yet — that&apos;s fine. Structure a dish from text once and I&apos;ll keep it here so next time
          is log-N-servings.
        </div>
      )}
      {listStatus === 'ok' && (
        <ul className="food-list">
          {recipes.map((r) => {
            const hint = recipeMacroHint(r.macros_per_serving);
            return (
              <li key={r.recipe_id}>
                <button type="button" className="food-row" onClick={() => void openRecipe(r)}>
                  <b>{r.name}</b>
                  <span>
                    {r.servings} serving{r.servings === 1 ? '' : 's'}
                    {hint ? ` · ${hint}/serving` : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <button type="button" className="lockbtn ghost" style={{ marginTop: 12 }} onClick={onClose}>
        Back to Food
      </button>
    </div>
  );
}
