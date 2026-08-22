import { useEffect, useState } from 'react';
import type { DietaryProfile, Recipe } from '@cadence/shared';
import { getDietaryProfile, type RecipeDraft } from '../../lib/api.ts';
import { RecipeFromChatPanel } from '../food/RecipeFromChatPanel.tsx';
import { RecipeSaveConfirm } from '../food/RecipeSaveConfirm.tsx';

/**
 * Paste a recipe (Food Journey 10) — the Kitchen's front door.
 *
 * Text in, a structured recipe with real per-serving numbers out, and a confirm card in between:
 * the numbers are worked out from the ingredients, so they are worth showing, and they are still a
 * reading of someone else's words, so nothing is saved until it is tapped.
 *
 * The dietary profile is loaded before the confirm so the allergy guard on the save card has
 * something to check against. Without it that guard silently passes, which is the wrong direction
 * for the one check on this screen that matters.
 */
export function KitchenPaste({ onCancel, onSaved }: { onCancel: () => void; onSaved: (recipe: Recipe) => void }) {
  const [draft, setDraft] = useState<RecipeDraft | null>(null);
  const [dietary, setDietary] = useState<DietaryProfile | null>(null);

  useEffect(() => {
    let alive = true;
    void getDietaryProfile().then((r) => {
      if (alive && r.status === 'ok') setDietary(r.profile);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (draft) {
    return (
      <RecipeSaveConfirm
        draft={draft}
        dietary={dietary}
        onCancel={() => setDraft(null)}
        onSaved={(recipe) => {
          setDraft(null);
          onSaved(recipe);
        }}
      />
    );
  }

  return <RecipeFromChatPanel onDraft={setDraft} onCancel={onCancel} />;
}
