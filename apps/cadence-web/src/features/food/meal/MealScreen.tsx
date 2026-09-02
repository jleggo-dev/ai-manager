/**
 * The meal is the screen (owner ruling 1 — canvas 1b). You open Breakfast, not Log: the draft
 * is a real, persistent object; every picker is a sub-surface that returns into it; the window
 * is visible; and closing is the one write. The greater Food screen stays reachable (the quiet
 * "Your whole day ›" link), and a one-food express lane survives via `onExpressSingle`.
 *
 * Props contract (for the integrator):
 *   meal?            — initial slot; the header chip stays changeable in one tap, asked once
 *   onClose          — ‹ back / after the meal closes; the draft itself stays open server-side
 *   onExpressSingle  — "Just one thing and you're done? Log a single food instead ›"
 *   onOpenDay?       — the quiet "Your whole day ›" link (omit to hide it)
 */
import { useState } from 'react';
import type { MealKind } from '@cadence/shared';
import { downscalePhoto } from '../../plan/occurrence/format.ts';
import { NamePartCard } from '../bracket/NamePartCard.tsx';
import { membersOf, partTotal } from '../bracket/partModel.ts';
import { nameChips } from './nameChips.ts';
import { MealBody } from './MealBody.tsx';
import { MealDoors, type MealDoor } from './MealDoors.tsx';
import { MealEmptyState } from './MealEmptyState.tsx';
import { MealFooter } from './MealFooter.tsx';
import { MealHeader } from './MealHeader.tsx';
import { MealMenu } from './MealMenu.tsx';
import { useGroupOffer } from './useGroupOffer.ts';
import { useMealDraft } from './useMealDraft.ts';

export interface MealScreenProps {
  meal?: MealKind;
  onClose: () => void;
  onExpressSingle: () => void;
  onOpenDay?: () => void;
}

type SaveFlow = { part: string; to: 'meal' | 'recipe' | 'rename' };

export function MealScreen({ meal: initialMeal, onClose, onExpressSingle, onOpenDay }: MealScreenProps) {
  const draft = useMealDraft(initialMeal);
  const offer = useGroupOffer();
  const [door, setDoor] = useState<MealDoor | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [saveFlow, setSaveFlow] = useState<SaveFlow | null>(null);

  const kind = draft.meal?.meal ?? initialMeal ?? 'breakfast';
  const logId = draft.meal?.log_id;

  const recordAppend = () => {
    if (logId) offer.recordAppend(logId);
  };

  const doClose = async () => {
    const r = await draft.close();
    if (r.ok) onClose();
  };

  /** Save-as targets the meal's one bracket, making it first when the meal is still flat.
   *  The key is the server's answer, never a guess — see groupLoose. */
  const wholePart = async (): Promise<string | null> => {
    const parts = draft.meal?.parts ?? [];
    if (parts.length > 0) return parts[0]!.key;
    if (draft.items.length < 2) return null;
    return draft.groupLoose(draft.items.map((_, i) => i));
  };

  const openSaveFlow = async (to: SaveFlow['to']) => {
    setMenuOpen(false);
    const part = await wholePart();
    if (part) setSaveFlow({ part, to });
  };

  if (draft.loading) {
    return <div className="ms" aria-busy="true" />;
  }

  if (door) {
    return (
      <div className="ms">
        <MealDoors
          door={door}
          draft={draft}
          onSwitch={setDoor}
          onClose={() => setDoor(null)}
          onAppended={recordAppend}
        />
      </div>
    );
  }

  const empty = draft.items.length === 0;

  return (
    <div className="ms">
      <MealHeader
        kind={kind}
        date={draft.meal?.date}
        count={draft.items.length}
        openLabel={draft.openLabel}
        openedClock={draft.openedClock}
        addsUntil={draft.addsUntil}
        busy={draft.busy}
        onBack={onClose}
        onKind={(k) => void draft.setMealKind(k)}
        onMenu={() => setMenuOpen(true)}
      />
      <div className="ms-scroll">
        {empty ? (
          <MealEmptyState
            kind={kind}
            busy={draft.busy}
            onSearch={() => setDoor({ at: 'add' })}
            onPhoto={(file) => {
              if (!file) return;
              void downscalePhoto(file).then((photo) => setDoor({ at: 'photo', photo }));
            }}
            onBarcode={() => setDoor({ at: 'barcode' })}
            onRecents={() => setDoor({ at: 'add' })}
            onMyMeals={() => setDoor({ at: 'shelf' })}
            onAddRecipe={(recipeId) =>
              void draft.appendRecipe({ recipe_id: recipeId }).then((m) => m && recordAppend())
            }
            onExpressSingle={onExpressSingle}
            onOpenDay={onOpenDay}
          />
        ) : (
          <>
            <MealBody
              draft={draft}
              offerVisible={offer.shouldOffer(draft.meal)}
              onOfferAccept={(name) => {
                void draft.groupLoose(
                  draft.items.map((_, i) => i),
                  name,
                );
              }}
              onOfferDecline={() => {
                if (logId) offer.decline(logId);
              }}
              onAddAnother={() => setDoor({ at: 'add' })}
            />
            {onOpenDay && (
              <button type="button" className="ms-day-link" onClick={onOpenDay}>
                Your whole day ›
              </button>
            )}
          </>
        )}
        {draft.err && <div className="food-empty">{draft.err}</div>}
      </div>
      {!empty && (
        <MealFooter
          kind={kind}
          total={draft.total}
          askedCount={draft.askedCount}
          busy={draft.busy}
          onCloseMeal={() => void doClose()}
        />
      )}
      {menuOpen && (
        <MealMenu
          canSave={draft.items.length >= 2 || (draft.meal?.parts ?? []).length > 0}
          onSaveMeal={() => void openSaveFlow('meal')}
          onSaveRecipe={() => void openSaveFlow('recipe')}
          onRename={() => void openSaveFlow('rename')}
          onCloseNow={() => {
            setMenuOpen(false);
            void doClose();
          }}
          onClose={() => setMenuOpen(false)}
        />
      )}
      {saveFlow && <SaveFlowCard draft={draft} flow={saveFlow} onClose={() => setSaveFlow(null)} />}
    </div>
  );
}

/**
 * "What do you call this?" over the meal's bracket. With a name, saving and naming are the
 * same act (savePartAsRecipe); renaming alone never touches the cookbook — grouping is not
 * saving. Yield rides the same card (canvas C3).
 */
function SaveFlowCard({
  draft,
  flow,
  onClose,
}: {
  draft: ReturnType<typeof useMealDraft>;
  flow: SaveFlow;
  onClose: () => void;
}) {
  const [name, setName] = useState<string | null>(null);
  const [servings, setServings] = useState(1);
  const members = membersOf(draft.items, flow.part);
  const count = members.length || draft.items.length;
  return (
    <div className="ms-sheet-backdrop" onClick={onClose}>
      <div className="ms-sheet" role="dialog" aria-label="What do you call this?" onClick={(e) => e.stopPropagation()}>
        <NamePartCard
          count={count}
          est={members.length ? partTotal(draft.items, flow.part) : draft.total}
          chips={nameChips(
            draft.rawTexts,
            (members.length ? members : draft.items.map((_, i) => i)).map((i) => draft.items[i]?.name ?? ''),
          )}
          onName={setName}
          onYield={setServings}
          onSave={() => {
            if (flow.to !== 'rename' && name) {
              void draft.saveAs({ part: flow.part, name, yield_servings: servings });
            } else {
              draft.editParts({ op: 'rename', part: flow.part, name: name ?? '' });
              if (servings > 1) draft.editParts({ op: 'set_yield', part: flow.part, yield_servings: servings });
            }
            onClose();
          }}
          onCancel={onClose}
        />
      </div>
    </div>
  );
}
