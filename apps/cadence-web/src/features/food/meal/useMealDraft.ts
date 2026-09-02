/**
 * The draft client (meal-logging rework P4 — docs/cadence/MEAL-LOGGING.md, 1b).
 *
 * One hook owns the open meal: open/rejoin on mount, appends from every door, the stepper,
 * parts ops previewed through the bracket's own reducers, the visible window, and the close.
 * Server truth wins — every mutation returns the whole meal — but amounts and parts apply
 * optimistically first so a stepper tap never waits on the network. The engine (state, the
 * 409 reopen-and-retry-once rule, reconciliation) lives in `useDraftCore.ts`.
 */
import { useCallback, useMemo } from 'react';
import type { MealKind, Macros } from '@cadence/shared';
import {
  appendFood as apiAppendFood,
  appendParsed as apiAppendParsed,
  appendRecipe as apiAppendRecipe,
  closeMeal as apiCloseMeal,
  editMealParts as apiEditMealParts,
  removeDraftItem,
  savePartAsRecipe,
  setDraftAmount,
  setDraftMeal,
  type Meal,
  type MealPartOp,
} from '../../../lib/api/meal-draft.ts';
import { useInvalidateNutritionDay } from '../../../lib/query/index.ts';
import { amountSource, scaleMacros } from '../amounts.ts';
import { sumEst } from '../bracket/partModel.ts';
import {
  applyPartsOp,
  CANT,
  clock,
  shiftProvenance,
  useDraftCore,
  WINDOW_MS,
  type DoorTag,
  type DraftCore,
} from './useDraftCore.ts';

export type { DoorTag };

export interface ParsedAppendItem {
  name: string;
  brand?: string;
  qty?: number;
  unit?: string;
  est?: Macros;
  food_id?: string;
}

/** The append family — every door lands here; provenance rides along, display-only. */
function useDraftAppends(core: DraftCore) {
  const { mutate, tagNew, prov, mealRef, setRawTexts } = core;

  const appendFood = useCallback(
    async (input: { food_id: string; serving_index?: number; quantity?: number }, tag?: DoorTag) => {
      const updated = await mutate((id) => apiAppendFood(id, input));
      if (updated && tag) tagNew(updated, 1, () => tag);
      return updated;
    },
    [mutate, tagNew],
  );

  const appendRecipe = useCallback(
    (input: { recipe_id: string; servings?: number }) => mutate((id) => apiAppendRecipe(id, input)),
    [mutate],
  );

  /**
   * Rows a parser already produced — passed through verbatim, never re-parsed. Per-row tags:
   * an amount Cadence supplied reads ASSUMED; everything else keeps the door it came through.
   */
  const appendParsed = useCallback(
    async (items: ParsedAppendItem[], tag: DoorTag, rawText?: string) => {
      if (!items.length) return null;
      const updated = await mutate((id) => apiAppendParsed(id, { items }));
      if (updated) {
        tagNew(updated, items.length, (n) => {
          const it = items[n];
          if (!it) return tag;
          return it.qty != null && amountSource(it, rawText ?? null) === 'assumed' ? 'assumed' : tag;
        });
        if (rawText?.trim()) setRawTexts((rs) => [...rs, rawText.trim()]);
      }
      return updated;
    },
    [mutate, setRawTexts, tagNew],
  );

  const removeItem = useCallback(
    async (index: number) => {
      const updated = await mutate((id) => removeDraftItem(id, index));
      if (updated) prov.current = shiftProvenance(prov.current, index);
      return updated;
    },
    [mutate, prov],
  );

  /** The strip's Undo — pull the last add straight back out. */
  const undoLast = useCallback(async () => {
    const current = mealRef.current;
    if (!current || !current.items.length) return null;
    return removeItem(current.items.length - 1);
  }, [mealRef, removeItem]);

  return { appendFood, appendRecipe, appendParsed, removeItem, undoLast };
}

/** The optimistic pair (stepper, bracket) plus the two acts that end a draft's story. */
function useDraftEdits(core: DraftCore) {
  const { seq, setMealState, mealRef, setPending, setErr, withDraft, reconcile } = core;
  const invalidateNutritionDay = useInvalidateNutritionDay();

  const optimistic = useCallback(
    (apply: (m: Meal) => Meal, call: (logId: string) => Promise<Meal>) => {
      const my = ++seq.current;
      setMealState((m) => {
        if (!m) return m;
        const next = apply(m);
        mealRef.current = next;
        return next;
      });
      setPending((p) => p + 1);
      withDraft(call)
        .then((server) => reconcile(my, server))
        .catch(() => setErr(CANT))
        .finally(() => setPending((p) => p - 1));
    },
    [mealRef, reconcile, seq, setErr, setMealState, setPending, withDraft],
  );

  /** A stepper nudge — est scaled locally, reconciled to the server's rescale. */
  const setAmount = useCallback(
    (index: number, qty: number) =>
      optimistic(
        (m) => ({
          ...m,
          items: m.items.map((it, i) => {
            if (i !== index) return it;
            const base = it.qty && it.qty > 0 ? it.qty : 1;
            return { ...it, qty, est: scaleMacros(it.est, qty / base) };
          }),
        }),
        (id) => setDraftAmount(id, index, qty),
      ),
    [optimistic],
  );

  /** A bracket edit, previewed through the same reducers the server enforces. */
  const editParts = useCallback(
    (op: MealPartOp) => optimistic((m) => applyPartsOp(m, op), (id) => apiEditMealParts(id, op)),
    [optimistic],
  );

  /**
   * Bracket the given loose rows; resolves to the new part's key FROM THE SERVER'S REPLY.
   * Keys are minted server-side (random, not sequential), so predicting one client-side is a
   * race that loses — the first live walkthrough hit exactly that: the group landed, then the
   * save-part call named a key the server had never issued and 400'd "no such part".
   */
  const groupLoose = useCallback(
    async (indexes: number[], name?: string | null): Promise<string | null> => {
      const before = new Set((mealRef.current?.parts ?? []).map((p) => p.key));
      const my = ++seq.current;
      setPending((p) => p + 1);
      setErr('');
      try {
        const server = await withDraft((id) =>
          apiEditMealParts(id, { op: 'group', item_indexes: indexes, ...(name !== undefined ? { name } : {}) }),
        );
        reconcile(my, server);
        return (server.parts ?? []).find((p) => !before.has(p.key))?.key ?? null;
      } catch {
        setErr(CANT);
        return null;
      } finally {
        setPending((p) => p - 1);
      }
    },
    [mealRef, reconcile, seq, setErr, setPending, withDraft],
  );

  /** Naming into the cookbook — naming and saving are the same act. */
  const saveAs = useCallback(
    async (input: { part: string; name: string; yield_servings?: number }): Promise<boolean> => {
      const my = ++seq.current;
      setPending((p) => p + 1);
      setErr('');
      try {
        const r = await withDraft((id) => savePartAsRecipe(id, input));
        reconcile(my, r.meal);
        return true;
      } catch {
        setErr(CANT);
        return false;
      } finally {
        setPending((p) => p - 1);
      }
    },
    [reconcile, seq, setErr, setPending, withDraft],
  );

  /** The commit. An empty draft closes to nothing. The day cache refreshes here, not per add. */
  const close = useCallback(async (): Promise<{ ok: boolean; meal: Meal | null }> => {
    const my = ++seq.current;
    setPending((p) => p + 1);
    setErr('');
    try {
      const closed = await withDraft((id) => apiCloseMeal(id));
      if (seq.current === my) core.adopt(closed);
      await invalidateNutritionDay();
      return { ok: true, meal: closed };
    } catch {
      setErr(CANT);
      return { ok: false, meal: mealRef.current };
    } finally {
      setPending((p) => p - 1);
    }
  }, [core, invalidateNutritionDay, mealRef, seq, setErr, setPending, withDraft]);

  return { setAmount, editParts, groupLoose, saveAs, close };
}

export function useMealDraft(initialMeal?: MealKind) {
  const core = useDraftCore(initialMeal);
  const appends = useDraftAppends(core);
  const edits = useDraftEdits(core);
  const { meal, now, prov, mutate } = core;

  /** The header chip — asked once, changeable in one tap. */
  const setMealKind = useCallback((kind: MealKind) => mutate((id) => setDraftMeal(id, kind)), [mutate]);

  const provenance = useCallback((index: number): DoorTag | undefined => prov.current.get(index), [prov]);

  const items = useMemo(() => meal?.items ?? [], [meal]);
  const askedCount = items.filter((it) => it.qty == null).length;
  const total = useMemo(() => sumEst(items, items.map((_, i) => i)), [items]);

  const closesAt = meal?.closes_at ? Date.parse(meal.closes_at) : null;
  const minsLeft = closesAt != null ? Math.max(0, Math.round((closesAt - now) / 60_000)) : null;

  return {
    meal,
    loading: core.loading,
    busy: core.pending > 0,
    err: core.err,
    clearErr: () => core.setErr(''),
    items,
    askedCount,
    total,
    rawTexts: core.rawTexts,
    provenance,
    /** "OPEN", tightening to "OPEN · 50 MIN LEFT" inside the last hour. */
    openLabel: meal ? (minsLeft != null && minsLeft <= 60 ? `OPEN · ${minsLeft} MIN LEFT` : 'OPEN') : null,
    /** "adds until 10:30" — the window is visible on-surface, never a silent rule. */
    addsUntil: closesAt != null ? `adds until ${clock(closesAt)}` : null,
    /** "07:08" — when the window opened (contract: closes_at − 3h). */
    openedClock: closesAt != null ? clock(closesAt - WINDOW_MS) : null,
    setMealKind,
    ...appends,
    ...edits,
  };
}

export type MealDraft = ReturnType<typeof useMealDraft>;
