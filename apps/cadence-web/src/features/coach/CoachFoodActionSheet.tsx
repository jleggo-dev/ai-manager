/**
 * Thin coach confirm sheet over the Recipe save + dietary confirms (Req 5 coach surface).
 * API prepares the draft; nothing commits until the user confirms here.
 *
 * **No sheet for a meal any more** (owner ruling 2026-08-19): the API's `prepareCoachFoodAction`
 * now returns null for `log_food`, because the Food home is a real screen with a diary and
 * one-tap confirm — a sheet arriving over the conversation competes with it. Recipes and dietary
 * updates keep their sheets: neither has a screen of its own.
 */
import { useEffect, useState } from 'react';
import type { DietaryProfile } from '@cadence/shared';
import { getDietaryProfile } from '../../lib/api.ts';
import type { CoachFoodAction } from '../../lib/api/coach-food.ts';
import { RecipeSaveConfirm } from '../food/RecipeSaveConfirm.tsx';
import { CoachDietaryConfirm } from './CoachDietaryConfirm.tsx';

type View = { mode: 'loading' } | { mode: 'recipe_save' } | { mode: 'dietary' } | { mode: 'error'; message: string };

export function CoachFoodActionSheet({
  action,
  onClose,
  onDone,
}: {
  action: CoachFoodAction;
  onClose: () => void;
  onDone: () => void;
}) {
  const [dietary, setDietary] = useState<DietaryProfile | null>(null);
  const [view, setView] = useState<View>({ mode: 'loading' });

  useEffect(() => {
    getDietaryProfile().then((r) => {
      if (r.status === 'ok') setDietary(r.profile);
    });
  }, []);

  useEffect(() => {
    if (action.kind === 'save_recipe') setView({ mode: 'recipe_save' });
    else if (action.kind === 'dietary_update') setView({ mode: 'dietary' });
    else setView({ mode: 'error', message: 'Say it again, or open the Food tab.' });
  }, [action]);

  return (
    <div className="sheet-scrim" role="presentation" onClick={onClose}>
      <div
        className="sheet coach-food-sheet"
        role="dialog"
        aria-label="Confirm food action"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-grab" />
        <div className="sheet-head">
          <div className="sheet-title">
            <b>Quick confirm</b>
            <span>Nothing counts until you say so</span>
          </div>
          <button type="button" className="sheet-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="sheet-body">
          {view.mode === 'loading' && (
            <div className="sheet-loading">
              <span className="typing">
                <i />
                <i />
                <i />
              </span>
              <div className="sheet-loading-t">Matching what you said…</div>
            </div>
          )}
          {view.mode === 'error' && (
            <div className="sheet-msg">
              {view.message}
              <div className="food-confirm-actions">
                <button type="button" className="lockbtn ghost" onClick={onClose}>
                  Close
                </button>
              </div>
            </div>
          )}
          {view.mode === 'recipe_save' && action.kind === 'save_recipe' && (
            <RecipeSaveConfirm draft={action.draft} dietary={dietary} onCancel={onClose} onSaved={() => onDone()} />
          )}
          {view.mode === 'dietary' && action.kind === 'dietary_update' && (
            <CoachDietaryConfirm proposed={action.proposed} onCancel={onClose} onSaved={onDone} />
          )}
        </div>
      </div>
    </div>
  );
}
