import { useEffect, useState } from 'react';
import type { DietaryProfile, Recipe } from '@cadence/shared';
import { getDietaryProfile, type RecipeDraft } from '../../lib/api.ts';
import { FridgeFromPhotoPanel } from '../food/FridgeFromPhotoPanel.tsx';
import { RecipeDiscoverPanel } from '../food/RecipeDiscoverPanel.tsx';
import { RecipeFromChatPanel } from '../food/RecipeFromChatPanel.tsx';
import { RecipeSaveConfirm } from '../food/RecipeSaveConfirm.tsx';

/** The ways a recipe gets into the Kitchen: pasted words, a photo of the fridge, a look around. */
export type KitchenIntakeSource = 'paste' | 'snap' | 'discover';

/**
 * A recipe on its way into the Kitchen (Food Journey 10). Three ways in — paste what you cooked,
 * snap the fridge, look up a real recipe — and one shape for all of them: words or a photo in, a
 * structured draft with real per-serving numbers out, and a confirm card in between. The numbers
 * are worked out from the ingredients, so they are worth showing, and they are still a reading of
 * someone else's words, so nothing is saved until it is tapped.
 *
 * The dietary profile is loaded before the confirm so the allergy guard on the save card has
 * something to check against. Without it that guard silently passes, which is the wrong direction
 * for the one check on this screen that matters.
 */
export function KitchenIntake({
  source,
  onCancel,
  onSaved,
}: {
  source: KitchenIntakeSource;
  onCancel: () => void;
  onSaved: (recipe: Recipe) => void;
}) {
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

  if (source === 'snap') return <FridgeFromPhotoPanel onDraft={setDraft} onCancel={onCancel} />;
  if (source === 'discover') return <RecipeDiscoverPanel onDraft={setDraft} onCancel={onCancel} />;
  return <RecipeFromChatPanel onDraft={setDraft} onCancel={onCancel} />;
}
