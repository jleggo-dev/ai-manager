/**
 * B2 — no sheet at all (canvas turn-3 B2). ＋ on the row adds at the food's own default serving
 * and becomes a stepper in place; the serving sheet still exists but only opens for the
 * genuinely ambiguous (›). The field clears, the keyboard stays — focus never leaves search
 * between adds. Added is not logged: the strip reads "N things · not counted yet" and carries
 * the undo. No "add another?" confirmation, ever.
 */
import { useEffect, useRef, useState } from 'react';
import type { Food } from '@cadence/shared';
import { getFoodById, getFoodRecents, searchFoods, type FoodSummary } from '../../../lib/api.ts';
import { AddFoodSheet } from '../AddFoodSheet.tsx';
import { FoodPickHead } from '../FoodPickRow.tsx';
import { fmtKcal } from '../bracket/copy.ts';
import { DraftStrip } from './DraftStrip.tsx';
import type { Meal } from '../../../lib/api/meal-draft.ts';
import type { MealDraft } from './useMealDraft.ts';

const DEBOUNCE_MS = 250;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** One addable line. ＋ adds straight in; › means the food asks first and opens the sheet. */
function PickRow({ food, busy, onAdd }: { food: FoodSummary; busy?: boolean; onAdd: (f: FoodSummary) => void }) {
  const asks = food.ambiguous !== false; // absent = unknown = ask, the conservative read
  const sub = asks
    ? [food.brand, 'several serving sizes · asks first'].filter(Boolean).join(' · ')
    : [food.brand, food.serving_label].filter(Boolean).join(' · ');
  return (
    <button type="button" className="fq-row fq-row-plain" disabled={busy} onClick={() => onAdd(food)}>
      <span className="fq-row-t">
        <b>{food.name}</b>
        {sub && <span>{sub}</span>}
      </span>
      <span className="fq-row-add" aria-hidden>
        {asks ? '›' : '＋'}
      </span>
    </button>
  );
}

/** A just-added row — the ＋ morphed into a stepper, still talking to the draft. */
function AddedRow({ draft, index }: { draft: MealDraft; index: number }) {
  const item = draft.items[index];
  if (!item) return null;
  const qty = item.qty ?? 1;
  return (
    <div className="ms-added-row">
      <span className="ms-added-n">{item.name}</span>
      <span className="ms-added-k">{typeof item.est?.kcal === 'number' ? `${fmtKcal(item.est.kcal)} kcal` : ''}</span>
      <div className="fa-step">
        <button
          type="button"
          aria-label={`Less ${item.name}`}
          disabled={draft.busy || qty <= 0.25}
          onClick={() => draft.setAmount(index, Math.max(0.25, round2(qty - 0.25)))}
        >
          −
        </button>
        <b>{[qty, item.unit].filter(Boolean).join(' ')}</b>
        <button
          type="button"
          aria-label={`More ${item.name}`}
          disabled={draft.busy}
          onClick={() => draft.setAmount(index, round2(qty + 0.25))}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function MealAddPanel({
  draft,
  seed = '',
  onDone,
  onDescribe,
  onAppended,
}: {
  draft: MealDraft;
  /** Words already typed into the meal's own field — they carry over, never retype. */
  seed?: string;
  onDone: () => void;
  /** Hand the words to the chat door — "Search, or just describe it…" keeps both promises. */
  onDescribe?: (text: string) => void;
  /** Fired after every successful append — the B3 offer counts these. */
  onAppended?: (meal: Meal) => void;
}) {
  const kind = draft.meal?.meal ?? 'breakfast';
  const [query, setQuery] = useState(seed);
  const [results, setResults] = useState<FoodSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [recents, setRecents] = useState<FoodSummary[]>([]);
  const [justAdded, setJustAdded] = useState<number[]>([]);
  const [addedByFood, setAddedByFood] = useState<Record<string, number>>({});
  const [sheet, setSheet] = useState<Food | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    void getFoodRecents().then((r) => alive && setRecents(r.foods.slice(0, 6)));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    let alive = true;
    setSearching(true);
    const t = setTimeout(() => {
      void searchFoods(q).then((r) => {
        if (!alive) return;
        setResults(r.foods.slice(0, 12));
        setSearching(false);
      });
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query]);

  /** The field clears, the keyboard stays. */
  const backToSearch = () => {
    setQuery('');
    setSheet(null);
    inputRef.current?.focus();
  };

  const landed = (m: Meal, foodId: string) => {
    const index = m.items.length - 1;
    setJustAdded((j) => [...j.filter((i) => i !== index), index]);
    setAddedByFood((map) => ({ ...map, [foodId]: index }));
    onAppended?.(m);
    backToSearch();
  };

  const addAtDefault = async (food: FoodSummary) => {
    const m = await draft.appendFood({ food_id: food.food_id }, 'searched');
    if (m) landed(m, food.food_id);
  };

  const openSheet = async (food: FoodSummary) => {
    const r = await getFoodById(food.food_id);
    if (r.status !== 'ok') {
      // No detail to price against — the one-tap default is still an honest add.
      void addAtDefault(food);
      return;
    }
    setSheet(r.food);
  };

  const onPick = (food: FoodSummary) => {
    if (food.ambiguous === false) void addAtDefault(food);
    else void openSheet(food);
  };

  /** Removal shifts every index above it down one — the morph map has to follow. */
  const dropIndex = (index: number) => {
    setJustAdded((j) => j.filter((i) => i !== index).map((i) => (i > index ? i - 1 : i)));
    setAddedByFood((map) => {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(map)) {
        if (v === index) continue;
        out[k] = v > index ? v - 1 : v;
      }
      return out;
    });
  };

  const undoLast = async () => {
    const last = (draft.items.length || 0) - 1;
    if (last < 0) return;
    const m = await draft.undoLast();
    if (m) dropIndex(last);
  };

  const removeAt = async (index: number) => {
    const m = await draft.removeItem(index);
    if (m) dropIndex(index);
  };

  const chips = justAdded.slice(-3).flatMap((i) => {
    const it = draft.items[i];
    return it ? [{ index: i, name: it.name }] : [];
  });
  const showResults = query.trim().length > 0;

  return (
    <div className="ms-panel">
      <div className="ms-panel-head">
        <button type="button" className="ms-back" aria-label="Back" onClick={onDone}>
          ‹
        </button>
        <h2>{`Add to ${kind}`}</h2>
      </div>
      <div className="ms-panel-scroll">
        <input
          ref={inputRef}
          className="ms-search"
          type="text"
          value={query}
          placeholder="Search foods…"
          aria-label="Search foods"
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />
        {justAdded.length > 0 && (
          <div>
            <FoodPickHead label="JUST ADDED · TAP TO ADJUST" />
            {justAdded
              .slice()
              .reverse()
              .map((i) => (
                <AddedRow key={i} draft={draft} index={i} />
              ))}
          </div>
        )}
        {showResults && (
          <div>
            {results.map((f) => (
              <PickRow key={f.food_id} food={f} busy={draft.busy} onAdd={onPick} />
            ))}
            {!searching && results.length === 0 && <p className="ms-panel-note">Nothing by that name yet.</p>}
            {onDescribe && (
              <button type="button" className="ms-express" onClick={() => onDescribe(query)}>
                <b>Or describe it in a sentence ›</b>
              </button>
            )}
          </div>
        )}
        {!showResults && recents.length > 0 && (
          <div>
            <FoodPickHead label="RECENTLY EATEN" />
            {recents.map((f) =>
              addedByFood[f.food_id] != null ? (
                <AddedRow key={f.food_id} draft={draft} index={addedByFood[f.food_id]!} />
              ) : (
                <PickRow key={f.food_id} food={f} busy={draft.busy} onAdd={onPick} />
              ),
            )}
          </div>
        )}
        <p className="ms-panel-note">
          {
            'A ＋ adds it straight in. A › means that food has several serving sizes worth asking about, so it opens the sheet.'
          }
        </p>
        {draft.err && <div className="food-empty">{draft.err}</div>}
      </div>
      <DraftStrip
        mealLabel={kind}
        count={draft.items.length}
        kcal={draft.total.kcal}
        chips={chips}
        busy={draft.busy}
        onUndo={() => void undoLast()}
        onRemove={(i) => void removeAt(i)}
        doneLabel={`Done · back to ${kind}`}
        onDone={onDone}
      />
      {sheet && (
        // A cover, not a footer. Rendered in flow it landed BELOW the strip — off the bottom of a
        // panel already taller than the sheet it lives in — so tapping a › food looked like
        // nothing happened at all (owner, on device, 2026-09-06). The panel stays mounted behind
        // it so the search field, its text and its focus survive the round trip.
        <div className="ms-cover" role="dialog" aria-label="Add food">
          <AddFoodSheet
            food={sheet}
            meal={kind}
            mode="draft"
            mealLabel={kind}
            busy={draft.busy}
            onAdd={(p) => {
              void draft
                .appendFood({ food_id: sheet.food_id, serving_index: p.servingIndex, quantity: p.quantity }, 'searched')
                .then((m) => {
                  if (m) landed(m, sheet.food_id);
                });
            }}
            onLog={() => {}}
            onBack={backToSearch}
            strip={
              <DraftStrip
                mealLabel={kind}
                count={draft.items.length}
                kcal={draft.total.kcal}
                chips={chips}
                busy={draft.busy}
                onUndo={() => void undoLast()}
                onRemove={(i) => void removeAt(i)}
              />
            }
          />
        </div>
      )}
    </div>
  );
}
