/**
 * The meal's doors (canvas 1c's one honest rule, applied to 1b): search, chat/voice, photo,
 * barcode and the cookbook shelf are alternative KEYBOARDS, not destinations — each appends
 * into the one open draft and returns to the meal. Resolved never re-resolves: a food picked
 * by id appends by id; rows a parser produced pass through appendParsed verbatim.
 */
import { useState } from 'react';
import type { Food } from '@cadence/shared';
import { AddFoodSheet } from '../AddFoodSheet.tsx';
import { FoodBarcodePanel } from '../FoodBarcodePanel.tsx';
import { LogByChat } from '../LogByChat.tsx';
import { PhotoReadPanel } from '../PhotoReadPanel.tsx';
import { CookbookShelf } from '../shelf/CookbookShelf.tsx';
import { DraftStrip } from './DraftStrip.tsx';
import { foodNeedsAsking } from './draftChips.ts';
import { MealAddPanel } from './MealAddPanel.tsx';
import type { MealDraft } from './useMealDraft.ts';

export type MealDoor =
  | { at: 'add'; seed?: string }
  | { at: 'chat'; listening?: boolean }
  | { at: 'photo'; photo: string; caption?: string }
  | { at: 'barcode' }
  | { at: 'shelf' };

export function MealDoors({
  door,
  draft,
  onSwitch,
  onClose,
}: {
  door: MealDoor;
  draft: MealDraft;
  onSwitch: (door: MealDoor) => void;
  onClose: () => void;
}) {
  const kind = draft.meal?.meal ?? 'breakfast';
  const [scanSheet, setScanSheet] = useState<Food | null>(null);

  const appendScanned = (food: Food, portion?: { servingIndex: number; quantity: number }) => {
    void draft
      .appendFood(
        {
          food_id: food.food_id,
          ...(portion ? { serving_index: portion.servingIndex, quantity: portion.quantity } : {}),
        },
        'scanned',
      )
      .then((m) => {
        if (m) {
          setScanSheet(null);
          onClose();
        }
      });
  };

  if (door.at === 'add') {
    return <MealAddPanel draft={draft} seed={door.seed} onDone={onClose} onDescribe={() => onSwitch({ at: 'chat' })} />;
  }

  if (door.at === 'chat') {
    return (
      <LogByChat
        meal={kind}
        listening={door.listening}
        mode="draft"
        mealLabel={kind}
        onAppend={async (preview) => {
          const m = await draft.appendParsed(preview.items, door.listening ? 'heard' : 'typed', preview.raw_text);
          return !!m;
        }}
        onLogged={onClose}
        onBack={onClose}
        onPhoto={(photo, caption) => onSwitch({ at: 'photo', photo, caption })}
      />
    );
  }

  if (door.at === 'photo') {
    return (
      <PhotoReadPanel
        photo={door.photo}
        meal={kind}
        initialCaption={door.caption}
        mode="draft"
        appendDraft={async (items, rawText) => {
          const m = await draft.appendParsed(items, 'assumed', rawText);
          if (m) onClose();
          return !!m;
        }}
        onLogged={onClose}
        onBack={onClose}
      />
    );
  }

  if (door.at === 'shelf') {
    return (
      <CookbookShelf
        onPick={(recipe, servings) => {
          void draft.appendRecipe({ recipe_id: recipe.recipe_id, servings }).then((m) => {
            if (m) onClose();
          });
        }}
        onClose={onClose}
      />
    );
  }

  return (
    <>
      <FoodBarcodePanel
        onDraft={(d) => {
          if (d.kind !== 'saved') return;
          if (foodNeedsAsking(d.food)) setScanSheet(d.food);
          else appendScanned(d.food);
        }}
        onCancel={onClose}
      />
      {scanSheet && (
        // A cover, for the same reason the add panel's is: in flow it stacked under the scanner
        // and never entered the viewport. The scanner stays mounted behind it.
        <div className="ms-cover" role="dialog" aria-label="Add food">
          <AddFoodSheet
            food={scanSheet}
            meal={kind}
            mode="draft"
            mealLabel={kind}
            busy={draft.busy}
            onAdd={(p) => appendScanned(scanSheet, p)}
            onLog={() => {}}
            onBack={() => setScanSheet(null)}
            strip={
              <DraftStrip
                mealLabel={kind}
                count={draft.items.length}
                kcal={draft.total.kcal}
                logged={draft.logged}
                busy={draft.busy}
                onUndo={() => void draft.undoLast()}
              />
            }
          />
        </div>
      )}
    </>
  );
}
