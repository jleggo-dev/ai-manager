/**
 * The quick log — the meal drawer, simplified (owner's "too much to read" steer, canvas
 * "Cadence Quick Log", 2026-10-28). Tap what you ate: the drawer is a shelf of your foods, not
 * a form. Top to bottom:
 *
 *   the title (it IS the slot picker) · Cadence's face · ⋯
 *   the day — kcal ring and three bars, the cart previewed as a pale arc and a hatched tail
 *   four doors, icon-only — type it (primary) · voice · photo · barcode — all four LOG
 *   a filter bar over the shelves: your foods, every shelf; no match hands the words to the coach
 *   four shelves — Planned (absent when the week names nothing) · Usual · Leftovers · Cookbook
 *   two-column tiles that scroll on: tap = +1, tap again = ×2, hold = the amount sheet
 *   the cart — chips with ×, one button: "Log breakfast · kcal"
 *
 * Turn 1 of the canvas (2026-10-29): typing and voice open "What did you have?" as a sheet over the
 * drawer, and her face opens a chat about this meal as a second panel inside it (MealChatPanel).
 *
 * Gone: the OPEN pill, ‹ (the drawer swipes down), "change ⌄", the window line, the empty-state
 * paragraph, labels under the doors, the express lane, photos. Advice lives elsewhere — the
 * face is the one door to it, and the four doors never talk.
 *
 * The draft is still a real, persistent object (`useMealDraft`): every door appends into it,
 * logging is the one write, and reopening a slot rejoins it. Adds on a logged meal count as
 * they land (the cart ruling, 2026-09-07).
 *
 * Props contract (for the integrator):
 *   meal?      — the slot; inferred from the clock when absent
 *   date?      — the slot's date (a missed breakfast from yesterday is yesterday's)
 *   openAt?    — the door the caller ALREADY chose (a capture tile) — open in it, don't ask again
 *   onClose    — the drawer swiped down; the draft itself stays open server-side
 *   onLogged?  — after "Log breakfast" lands (or Done on a logged meal); defaults to onClose
 *   onOpenDay? — the day card's tap: the whole day in Food (omit and the card is plain)
 *   onCoach?   — shows her face, which opens the in-drawer meal chat (omit to hide). The note it was
 *                once handed is now spoken inside the drawer; the prop stays the face's switch
 */
import { useState } from 'react';
import type { MealKind } from '@cadence/shared';
import { localTodayIso, useNutritionDay } from '../../../lib/query/index.ts';
import { AmountSheet, ServingsSheet } from './AmountSheet.tsx';
import { CartBar } from './CartBar.tsx';
import { quickLogCoachNote } from './coachNote.ts';
import { DayMacros } from './DayMacros.tsx';
import { DescribeSheet } from './DescribeSheet.tsx';
import { FindBar, FindEmpty } from './FindBar.tsx';
import { findTiles } from './findTiles.ts';
import { MealChatPanel } from './MealChatPanel.tsx';
import { MealDoors, type MealDoor } from './MealDoors.tsx';
import { MealDoorsRow } from './MealDoorsRow.tsx';
import { MealItemSheet } from './MealItemSheet.tsx';
import { MealMenu } from './MealMenu.tsx';
import { MealTitle } from './MealTitle.tsx';
import { SaveFlowCard, type SaveFlow } from './SaveFlowCard.tsx';
import { ShelfGrid } from './ShelfGrid.tsx';
import { ShelfTabs } from './ShelfTabs.tsx';
import { useDrawerDrag } from './useDrawerDrag.ts';
import { useMealDraft } from './useMealDraft.ts';
import { useQuickLogCart } from './useQuickLogCart.ts';
import { useHoldHint } from './useHoldHint.ts';
import { useShelves, type ShelfKey, type ShelfTile } from './useShelves.ts';

export interface MealScreenProps {
  meal?: MealKind;
  date?: string;
  openAt?: MealDoor;
  onClose: () => void;
  onLogged?: () => void;
  onOpenDay?: () => void;
  onCoach?: (note: string) => void;
}

/** The pencil (or the mic) — "What did you have?" over the drawer, maybe carrying words already typed. */
type Describe = { seed?: string; listening?: boolean };

type Sheet =
  { kind: 'amount'; tile: ShelfTile } | { kind: 'servings'; tile: ShelfTile } | { kind: 'item'; index: number };

export function MealScreen({
  meal: initialMeal,
  date,
  openAt,
  onClose,
  onLogged,
  onOpenDay,
  onCoach,
}: MealScreenProps) {
  const today = localTodayIso();
  const draft = useMealDraft(initialMeal, date);
  const kind = draft.meal?.meal ?? initialMeal ?? 'breakfast';
  const mealDate = draft.meal?.date ?? date ?? today;
  const { data: day } = useNutritionDay(mealDate);

  const logId = draft.meal?.log_id;
  const parts = draft.meal?.parts;
  const shelves = useShelves(kind, mealDate, today, logId ?? null);
  const cart = useQuickLogCart(draft, shelves.planned);

  const [shelf, setShelf] = useState<ShelfKey | null>(null);
  const active: ShelfKey = shelf && shelves.keys.includes(shelf) ? shelf : (shelves.keys[0] ?? 'usual');
  // A capture tile that already chose typing or voice opens the sheet, not a screen of its own.
  const [door, setDoor] = useState<MealDoor | null>(openAt?.at === 'chat' ? null : (openAt ?? null));
  const [describe, setDescribe] = useState<Describe | null>(
    openAt?.at === 'chat' ? { listening: openAt.listening } : null,
  );
  const [query, setQuery] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [saveFlow, setSaveFlow] = useState<SaveFlow | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const drag = useDrawerDrag(onClose);
  const holdHint = useHoldHint();

  const busy = draft.busy || draft.loading;
  const afterLogged = onLogged ?? onClose;

  const doLog = async () => {
    const r = await draft.close();
    if (r.ok) afterLogged();
  };

  /** Save-as targets the meal's one bracket, making it first when the meal is still flat. */
  const openSaveFlow = async (to: SaveFlow['to']) => {
    setMenuOpen(false);
    const existing = draft.meal?.parts ?? [];
    const part =
      existing.length > 0
        ? existing[0]!.key
        : draft.items.length < 2
          ? null
          : await draft.groupLoose(draft.items.map((_, i) => i));
    if (part) setSaveFlow({ part, to });
  };

  const stepShelf = (dir: 1 | -1) => {
    const i = shelves.keys.indexOf(active);
    const next = shelves.keys[Math.min(shelves.keys.length - 1, Math.max(0, i + dir))];
    if (next && next !== active) setShelf(next);
  };

  const hold = (tile: ShelfTile) => {
    holdHint.retire();
    if (tile.kind === 'food') setSheet({ kind: 'amount', tile });
    else if (tile.kind === 'recipe') setSheet({ kind: 'servings', tile });
  };

  const openDoor = (d: MealDoor) => {
    if (d.at === 'chat') setDescribe({ listening: d.listening });
    else setDoor(d);
  };

  const chatNote = () =>
    quickLogCoachNote(
      {
        meal: kind,
        date: mealDate,
        items: draft.items,
        parts: parts ?? [],
        total: draft.total,
        logged: draft.logged,
      },
      today,
      true,
    );

  if (door) {
    // `ms-in-door` lets the host fold its own chrome away while a keyboard-shaped surface is up.
    return (
      <div className="ms ms-in-door">
        <MealDoors door={door} draft={draft} onSwitch={setDoor} onClose={() => setDoor(null)} />
      </div>
    );
  }

  const openItem = sheet?.kind === 'item' ? draft.items[sheet.index] : null;
  const searching = query.trim().length > 0;
  const found = searching ? findTiles(shelves.tiles, shelves.keys, query) : [];
  const mealTitle = kind[0]!.toUpperCase() + kind.slice(1);

  return (
    <div ref={drag.ref} className="ms ms-quick" aria-busy={draft.loading || undefined}>
      {/* The drag zone: handle, title, the day. The shelf below keeps its own gestures. */}
      <div className="ms-drag" {...drag.handlers}>
        <div className="ms-grab" aria-hidden="true" />
        <MealTitle
          kind={kind}
          busy={busy}
          locked={draft.logged}
          onKind={(k) => void draft.setMealKind(k)}
          onCoach={onCoach ? () => setChatOpen(true) : undefined}
          onMenu={() => setMenuOpen(true)}
        />
        <DayMacros day={day} cart={draft.logged ? {} : draft.total} onOpenDay={onOpenDay} />
      </div>
      <MealDoorsRow busy={busy} onOpen={openDoor} />
      <FindBar query={query} onQuery={setQuery} />
      <ShelfTabs keys={shelves.keys} active={active} onPick={setShelf} />
      {searching && found.length === 0 ? (
        <FindEmpty
          query={query}
          onTell={(words) => {
            setQuery('');
            setDescribe({ seed: words });
          }}
        />
      ) : (
        <ShelfGrid
          shelf={active}
          tiles={searching ? found : shelves.tiles[active]}
          countOf={cart.countOf}
          busy={busy}
          onTap={(t) => void cart.tap(t)}
          onHold={hold}
          onSwipe={searching ? () => {} : stepShelf}
          hint={holdHint.show}
          onEnd={searching ? undefined : shelves.more[active]}
        />
      )}
      {draft.err && <div className="food-empty ms-err">{draft.err}</div>}
      <CartBar
        kind={kind}
        chips={cart.chips}
        total={draft.total}
        askedCount={draft.askedCount}
        logged={draft.logged}
        busy={draft.busy}
        onOpenChip={(c) => setSheet({ kind: 'item', index: c.indexes[0]! })}
        onRemoveChip={(c) => void cart.removeChip(c)}
        onLog={() => void doLog()}
        onDone={afterLogged}
      />
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
      {describe && (
        <DescribeSheet
          meal={kind}
          seed={describe.seed}
          listening={describe.listening}
          busy={draft.busy}
          onAdd={async (items, raw) => !!(await draft.appendParsed(items, describe.listening ? 'heard' : 'typed', raw))}
          onClose={() => setDescribe(null)}
          onPhoto={(photo, caption) => {
            setDescribe(null);
            setDoor({ at: 'photo', photo, caption });
          }}
        />
      )}
      {chatOpen && (
        <MealChatPanel
          mealTitle={mealTitle}
          chips={cart.chips.map((c) => c.label)}
          kcal={draft.total.kcal ?? 0}
          state={draft.logged ? 'logged' : draft.items.length ? 'cart' : 'empty'}
          note={chatNote()}
          onBack={() => setChatOpen(false)}
        />
      )}
      {saveFlow && <SaveFlowCard draft={draft} flow={saveFlow} onClose={() => setSaveFlow(null)} />}
      {sheet?.kind === 'amount' && (
        <AmountSheet
          foodId={sheet.tile.id}
          name={sheet.tile.name}
          busy={draft.busy}
          onAdd={(p) => {
            setSheet(null);
            void cart.addFoodPortion(sheet.tile.id, p);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'servings' && (
        <ServingsSheet
          name={sheet.tile.name}
          sub={sheet.tile.sub}
          kcalPerServing={sheet.tile.kcal}
          busy={draft.busy}
          onAdd={(n) => {
            setSheet(null);
            void cart.addRecipe(sheet.tile.id, n);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {openItem && sheet?.kind === 'item' && (
        <MealItemSheet
          item={openItem}
          index={sheet.index}
          tag={draft.provenance(sheet.index)}
          busy={draft.busy}
          onQty={draft.setAmount}
          onRemove={(i) => void draft.removeItem(i)}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}
