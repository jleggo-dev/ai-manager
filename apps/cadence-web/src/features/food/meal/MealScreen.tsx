/**
 * The meal is the screen (owner ruling 1 — canvas 1b). You open Breakfast, not Log: the draft
 * is a real, persistent object; every picker is a sub-surface that returns into it; the window
 * is visible; and logging is the one write. The greater Food screen stays reachable (the quiet
 * "Your whole day ›" link), and a one-food express lane survives via `onExpressSingle`.
 *
 * Since the cart ruling (owner, 2026-09-07) it reads top to bottom as a cart: the things in it,
 * "＋ Add more", the doors as one row (Find first), then the shelf of what they usually have at
 * this slot — one tap each — and the totals with "Log breakfast" pinned at the bottom. Every
 * door returns here. Once logged, the same screen stays open to adds, which count as they land.
 *
 * Props contract (for the integrator):
 *   meal?            — the slot; the header chip stays changeable in one tap, asked once
 *   date?            — the slot's date (a missed breakfast from yesterday is yesterday's)
 *   planned?         — the week's menu for the slot, when there is one — leads the shelf
 *   openAt?          — the door the caller ALREADY chose (a capture tile) — open in it, don't ask again
 *   onClose          — ‹ back; the draft itself stays open server-side
 *   onLogged?        — after "Log breakfast" lands (or Done on a logged meal); defaults to onClose
 *   onExpressSingle? — "Just one thing and you're done? Log a single food instead ›" (omit to hide)
 *   onOpenDay?       — the quiet "Your whole day ›" link (omit to hide it)
 */
import { useState } from 'react';
import type { MealKind } from '@cadence/shared';
import type { PlannedMeal } from '../../plan/occurrence/usePlannedMeal.ts';
import { NamePartCard } from '../bracket/NamePartCard.tsx';
import { looseItems, membersOf, partTotal } from '../bracket/partModel.ts';
import { nameChips } from './nameChips.ts';
import { MealBody } from './MealBody.tsx';
import { MealDoors, type MealDoor } from './MealDoors.tsx';
import { MealDoorsRow } from './MealDoorsRow.tsx';
import { MealEmptyState } from './MealEmptyState.tsx';
import { MealFooter } from './MealFooter.tsx';
import { MealHeader } from './MealHeader.tsx';
import { MealMenu } from './MealMenu.tsx';
import { MealUsualList } from './MealUsualList.tsx';
import { useGroupOffer } from './useGroupOffer.ts';
import { useMealDraft, type ParsedAppendItem } from './useMealDraft.ts';

export interface MealScreenProps {
  meal?: MealKind;
  date?: string;
  planned?: PlannedMeal | null;
  /**
   * The door to open in. A caller that already asked "how do you want to add this" — the capture
   * sheet's method tiles — answers it here, so the tap lands IN chat / search / the scanner
   * instead of on the meal's own picker asking the same question a second time.
   */
  openAt?: MealDoor;
  onClose: () => void;
  onLogged?: () => void;
  onExpressSingle?: () => void;
  onOpenDay?: () => void;
}

type SaveFlow = { part: string; to: 'meal' | 'recipe' | 'rename' };

/** A planned dish's rows, as the parser would hand them over — never re-parsed, never priced twice. */
function plannedRows(meal: PlannedMeal): ParsedAppendItem[] {
  return (meal.items ?? []).map((it) => ({
    name: it.name,
    qty: it.qty,
    ...(it.unit ? { unit: it.unit } : {}),
    ...(it.kind === 'food' ? { food_id: it.id } : {}),
    est: {
      ...(typeof it.kcal === 'number' ? { kcal: it.kcal } : {}),
      ...(typeof it.protein_g === 'number' ? { protein_g: it.protein_g } : {}),
      ...(typeof it.carbs_g === 'number' ? { carbs_g: it.carbs_g } : {}),
      ...(typeof it.fat_g === 'number' ? { fat_g: it.fat_g } : {}),
    },
  }));
}

export function MealScreen({
  meal: initialMeal,
  date,
  planned,
  openAt,
  onClose,
  onLogged,
  onExpressSingle,
  onOpenDay,
}: MealScreenProps) {
  const draft = useMealDraft(initialMeal, date);
  const offer = useGroupOffer();
  const [door, setDoor] = useState<MealDoor | null>(openAt ?? null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [saveFlow, setSaveFlow] = useState<SaveFlow | null>(null);

  const kind = draft.meal?.meal ?? initialMeal ?? 'breakfast';
  const logId = draft.meal?.log_id;
  const afterLogged = onLogged ?? onClose;

  const recordAppend = () => {
    if (logId) offer.recordAppend(logId);
  };

  const doLog = async () => {
    const r = await draft.close();
    if (r.ok) afterLogged();
  };

  const addPlanned = (p: PlannedMeal) => {
    const landed = p.recipe_id
      ? draft.appendRecipe({ recipe_id: p.recipe_id })
      : draft.appendParsed(plannedRows(p), 'assumed');
    void landed.then((m) => m && recordAppend());
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

  if (door) {
    // `ms-in-door` lets the host fold its own chrome (the capture's ring strip) away while a
    // keyboard-shaped surface is up — with the keyboard raised, those 110px were a third of
    // what the chat had left (measured at a 480px visible height, 2026-09-07).
    return (
      <div className="ms ms-in-door">
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
    <div className="ms" aria-busy={draft.loading || undefined}>
      <MealHeader
        kind={kind}
        count={draft.items.length}
        loose={looseItems(draft.items, draft.meal?.parts ?? []).length}
        logged={draft.logged}
        openLabel={draft.openLabel}
        addsUntil={draft.addsUntil}
        busy={draft.busy || draft.loading}
        onBack={onClose}
        onKind={(k) => void draft.setMealKind(k)}
        onMenu={() => setMenuOpen(true)}
      />
      <div className="ms-scroll">
        {draft.loading ? (
          <div className="ms-empty-mark" aria-hidden="true">
            ◌
          </div>
        ) : empty ? (
          <MealEmptyState onExpressSingle={onExpressSingle} />
        ) : (
          <MealBody
            draft={draft}
            offerVisible={offer.shouldOffer(draft.meal)}
            onOfferAccept={(name) => {
              // "Yes, together" with a name is a save, same as naming from the pill — a bracket
              // named and never in the cookbook is one the shelf can never offer back.
              void draft
                .groupLoose(
                  draft.items.map((_, i) => i),
                  name,
                )
                .then((key) => {
                  if (key && name) void draft.saveAs({ part: key, name });
                });
            }}
            onOfferDecline={() => {
              if (logId) offer.decline(logId);
            }}
            onAddMore={() => setDoor({ at: 'add' })}
          />
        )}
        <MealDoorsRow busy={draft.busy || draft.loading} onOpen={setDoor} onShelf={() => setDoor({ at: 'shelf' })} />
        <MealUsualList
          kind={kind}
          planned={planned ?? null}
          busy={draft.busy || draft.loading}
          onAddFood={(foodId) =>
            void draft.appendFood({ food_id: foodId }, 'searched').then((m) => m && recordAppend())
          }
          onAddRecipe={(recipeId) => void draft.appendRecipe({ recipe_id: recipeId }).then((m) => m && recordAppend())}
          onAddPlanned={planned ? () => addPlanned(planned) : undefined}
        />
        {onOpenDay && (
          <button type="button" className="ms-day-link" onClick={onOpenDay}>
            Your whole day ›
          </button>
        )}
        {draft.err && <div className="food-empty">{draft.err}</div>}
      </div>
      {!empty && (
        <MealFooter
          kind={kind}
          total={draft.total}
          askedCount={draft.askedCount}
          logged={draft.logged}
          busy={draft.busy}
          onLog={() => void doLog()}
          onDone={afterLogged}
        />
      )}
      {menuOpen && (
        <MealMenu
          canSave={draft.items.length >= 2 || (draft.meal?.parts ?? []).length > 0}
          logged={draft.logged}
          onSaveMeal={() => void openSaveFlow('meal')}
          onSaveRecipe={() => void openSaveFlow('recipe')}
          onRename={() => void openSaveFlow('rename')}
          onLogNow={() => {
            setMenuOpen(false);
            void doLog();
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
