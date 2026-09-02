/**
 * The draft engine under useMealDraft (meal-logging rework P4) — state, the open/rejoin, and
 * the one mutation rule every operation shares: server truth wins (each call returns the whole
 * meal and the newest response reconciles), and a 409 means the window closed under us — reopen
 * via `openMealDraft` (a fresh draft for the slot) and retry exactly once (P1 addendum).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MealKind } from '@cadence/shared';
import { getOpenMeal, openMealDraft, type Meal, type MealPartOp } from '../../../lib/api/meal-draft.ts';
import {
  addToPart,
  groupIndexes,
  removeFromPart,
  renamePart,
  ungroup,
  type PartsState,
} from '../bracket/partModel.ts';

/** Which door an item came through — display-only tags on the meal's rows. */
export type DoorTag = 'searched' | 'scanned' | 'heard' | 'typed' | 'assumed';

export const CANT = "Couldn't reach your meal just now — try again in a moment.";
/** Contract: closes_at = opened_at + 3h (MEAL-LOGGING.md), so the opened clock derives from it. */
export const WINDOW_MS = 3 * 60 * 60 * 1000;

const is409 = (e: unknown): boolean => e instanceof Error && /\s409$/.test(e.message);

export const clock = (t: number): string =>
  new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** A parts op previewed locally through the same reducers the server enforces. */
export function applyPartsOp(meal: Meal, op: MealPartOp): Meal {
  const state: PartsState = { items: meal.items, parts: meal.parts ?? [] };
  let next = state;
  if (op.op === 'group') next = groupIndexes(state, op.item_indexes, op.name);
  else if (op.op === 'ungroup') next = ungroup(state, op.part);
  else if (op.op === 'rename') next = renamePart(state, op.part, op.name);
  else if (op.op === 'add') next = addToPart(state, op.part, op.index);
  else if (op.op === 'remove') next = removeFromPart(state, op.part, op.index);
  else if (op.op === 'set_yield') {
    next = {
      items: state.items,
      parts: state.parts.map((p) =>
        p.key === op.part
          ? {
              ...p,
              yield_servings: op.yield_servings,
              ...(op.servings_logged != null ? { servings_logged: op.servings_logged } : {}),
            }
          : p,
      ),
    };
  }
  return { ...meal, items: next.items, parts: next.parts };
}

/** Provenance survives a removal: keys above the removed index slide down one. */
export function shiftProvenance(map: Map<number, DoorTag>, removed: number): Map<number, DoorTag> {
  const out = new Map<number, DoorTag>();
  for (const [k, v] of map) {
    if (k < removed) out.set(k, v);
    else if (k > removed) out.set(k - 1, v);
  }
  return out;
}

export function useDraftCore(initialMeal?: MealKind) {
  const [meal, setMealState] = useState<Meal | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(0);
  const [err, setErr] = useState('');
  const [rawTexts, setRawTexts] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const mealRef = useRef<Meal | null>(null);
  const seq = useRef(0);
  const prov = useRef(new Map<number, DoorTag>());

  const adopt = useCallback((m: Meal | null) => {
    mealRef.current = m;
    setMealState(m);
  }, []);

  /** Open, or rejoin the one open window — the 09:40 latte joins breakfast. */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const open = await getOpenMeal();
        const m = open ?? (await openMealDraft(initialMeal ? { meal: initialMeal } : {}));
        if (alive) adopt(m);
      } catch {
        if (alive) setErr("Couldn't open this meal just now — try again in a moment.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  /**
   * Run one draft mutation. On a 409 the window closed under us: reopen the slot (a fresh
   * draft, whose provenance and raw words start clean) and retry exactly once.
   */
  const withDraft = useCallback(
    async <T,>(fn: (logId: string) => Promise<T>): Promise<T> => {
      const current = mealRef.current;
      if (!current) throw new Error('no draft open');
      try {
        return await fn(current.log_id);
      } catch (e) {
        if (!is409(e)) throw e;
        const fresh = await openMealDraft({ meal: current.meal });
        prov.current = new Map();
        setRawTexts([]);
        adopt(fresh);
        return await fn(fresh.log_id);
      }
    },
    [adopt],
  );

  /** Reconcile to a server response unless a newer mutation has since started. */
  const reconcile = useCallback(
    (my: number, server: Meal) => {
      if (seq.current === my) adopt(server);
    },
    [adopt],
  );

  /** The plain round-trip: bump the sequence, run, reconcile, surface a plain error. */
  const mutate = useCallback(
    async (fn: (logId: string) => Promise<Meal>): Promise<Meal | null> => {
      const my = ++seq.current;
      setPending((p) => p + 1);
      setErr('');
      try {
        const updated = await withDraft(fn);
        reconcile(my, updated);
        return updated;
      } catch {
        setErr(CANT);
        return null;
      } finally {
        setPending((p) => p - 1);
      }
    },
    [reconcile, withDraft],
  );

  /** Tag the last `count` items of a reconciled meal with where they came from. */
  const tagNew = useCallback((updated: Meal, count: number, tag: (n: number) => DoorTag | undefined) => {
    for (let n = 0; n < count; n += 1) {
      const t = tag(n);
      if (t) prov.current.set(updated.items.length - count + n, t);
    }
  }, []);

  return {
    meal,
    loading,
    pending,
    err,
    setErr,
    rawTexts,
    setRawTexts,
    now,
    mealRef,
    seq,
    prov,
    adopt,
    setMealState,
    setPending,
    withDraft,
    reconcile,
    mutate,
    tagNew,
  };
}

export type DraftCore = ReturnType<typeof useDraftCore>;
