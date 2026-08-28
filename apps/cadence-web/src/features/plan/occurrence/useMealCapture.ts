import { useEffect, useState } from 'react';
import type { Food, MealPlanItem } from '@cadence/shared';
import {
  createFood,
  estimateFood,
  getFoodById,
  getFoodRecents,
  getPlateAdvice,
  logMealFromFood,
  logMealFromItems,
  logPlannedMealItems,
  portionHintFromResolve,
  resolveFoods,
  previewMeal,
  type MealPreview,
  type FoodSummary,
  type MealKind,
  type OccurrenceDetail,
  type PlateAdvice,
} from '../../../lib/api.ts';
import { useInvalidateNutritionDay, useNutritionDay } from '../../../lib/query/index.ts';
import type { FoodDraft, FoodDraftPortion } from '../../food/foodDraft.ts';
import { looksLikeMultiItemMeal } from '../../food/mealShape.ts';
import { downscalePhoto, mealForNow, mealFromTitle } from './format.ts';

export interface DraftPortion {
  servingIndex: number;
  quantity: number;
  meal: MealKind;
  name: string;
  brand: string;
}

/** One item on a plate — a resolved saved Food + its portion (design 2D). */
export interface PlateEntry {
  food: Food;
  servingIndex: number;
  quantity: number;
}

/**
 * Words (say / type) → the deterministic resolver → a single draft card. A clear best match (or the
 * top saved food) becomes the draft with its portion prefill; otherwise we estimate a fresh
 * candidate, still confirm-first. Pure API orchestration, no React state, so the hook stays lean.
 */
async function resolveToDraft(q: string, meal?: MealKind): Promise<{ draft?: FoodDraft; note?: string }> {
  const r = await resolveFoods({ text: q, ...(meal ? { meal } : {}) });
  const best =
    r.status === 'ok'
      ? ((r.preselected?.food_id ? r.preselected : null) ??
        r.candidates.find((c) => c.kind === 'food' && c.food_id) ??
        null)
      : null;
  if (best?.food_id) {
    const found = await getFoodById(best.food_id);
    if (found.status === 'ok' && found.food) {
      return { draft: { kind: 'saved', food: found.food, ...portionHintFromResolve(best) } };
    }
  }
  const est = await estimateFood(q);
  if (est.status === 'ok') return { draft: { kind: 'candidate', candidate: est.candidate } };
  return { note: est.message || "Couldn't read that one — try saying it a different way." };
}

/** A draft → its saved Food (creating it first if it was a fresh estimate). */
async function foodFromDraft(draft: FoodDraft, portion: DraftPortion): Promise<Food | null> {
  if (draft.kind === 'saved') return draft.food;
  return createFood({
    ...draft.candidate,
    name: portion.name.trim() || draft.candidate.name,
    brand: portion.brand.trim() || null,
    default_serving: portion.servingIndex,
  });
}

/** A confirmed draft → deterministic single-item log (real macros). */
async function commitDraft(draft: FoodDraft, portion: DraftPortion): Promise<{ ok: boolean; err?: string }> {
  const food = await foodFromDraft(draft, portion);
  if (!food) return { ok: false, err: "Couldn't save that food just now — try again in a moment." };
  const logged = await logMealFromFood({
    food_id: food.food_id,
    meal: portion.meal,
    serving_index: portion.servingIndex,
    quantity: portion.quantity,
  });
  if (!logged) return { ok: false, err: "Couldn't log that just now — try again in a moment." };
  return { ok: true };
}

/**
 * The plate (design 2D) — building one meal from N saved-food items. Split out of the main capture
 * hook so each stays lean: `addToPlate` commits the open draft (creating a new food first), `logPlate`
 * writes the whole plate as one meal with N items. Shares the parent's busy/error + draft state so the
 * sheet's buttons and the ring stay in sync.
 */
function usePlate(deps: {
  draft: FoodDraft | null;
  setDraft: (d: FoodDraft | null) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setLogErr: (s: string) => void;
  mealKind: MealKind;
  refreshDay: () => Promise<void>;
  markLogged: () => void;
}) {
  const [plate, setPlate] = useState<PlateEntry[]>([]);

  async function addToPlate(portion: DraftPortion) {
    if (!deps.draft || deps.busy) return;
    deps.setBusy(true);
    deps.setLogErr('');
    try {
      const food = await foodFromDraft(deps.draft, portion);
      if (!food) return deps.setLogErr("Couldn't save that food just now — try again in a moment.");
      setPlate((p) => [...p, { food, servingIndex: portion.servingIndex, quantity: portion.quantity }]);
      deps.setDraft(null);
    } finally {
      deps.setBusy(false);
    }
  }

  async function logPlate() {
    if (!plate.length || deps.busy) return;
    deps.setBusy(true);
    deps.setLogErr('');
    try {
      const logged = await logMealFromItems({
        items: plate.map((e) => ({ food_id: e.food.food_id, serving_index: e.servingIndex, quantity: e.quantity })),
        meal: deps.mealKind,
      });
      if (!logged) return deps.setLogErr("Couldn't log that plate just now — try again in a moment.");
      await deps.refreshDay();
      deps.markLogged();
    } finally {
      deps.setBusy(false);
    }
  }

  /**
   * MP19 — one-tap log of a composed planned dish (frame 10a — recipes, food, or both). The
   * legacy single-recipe planned dish no longer logs from here: MP24 routes it through
   * `RecipeQuickLog`/`RecipeLogConfirm` instead, so a tap always shows the portion confirm rather
   * than silently writing one serving.
   */
  async function logPlannedComposed(items: MealPlanItem[]) {
    if (deps.busy) return;
    deps.setBusy(true);
    deps.setLogErr('');
    try {
      const ok = await logPlannedMealItems(items, deps.mealKind);
      if (!ok) return deps.setLogErr("Couldn't log that just now — try again in a moment.");
      await deps.refreshDay();
      deps.markLogged();
    } finally {
      deps.setBusy(false);
    }
  }

  return {
    plate,
    addToPlate,
    logPlate,
    logPlannedComposed,
    setPlateQty: (i: number, quantity: number) => setPlate((p) => p.map((e, j) => (j === i ? { ...e, quantity } : e))),
    removePlateItem: (i: number) => setPlate((p) => p.filter((_, j) => j !== i)),
  };
}

/**
 * The meal-capture engine behind the redesign sheet. Two honest paths, both reused from what already
 * ships: words → the resolver → a draft card you confirm (real macros); a photo → the provisional
 * `logMeal` path (logs now, stays dashed/out of totals until confirmed, so capture never blocks on
 * the model's confidence). The day rollup drives the two-tone rings; recents feed the two-tap pills.
 * A meal ticks its occurrence server-side, so a log just refreshes the trail and closes the sheet.
 */
/**
 * A meal-shaped description → its itemized preview, or null to stay on the single-food resolver.
 * Null on ANY failure too: the resolver is the path that always works, so the parser being down
 * costs the nicer card, never the log. A one-item parse also falls through — the resolver's
 * portion confirm is the better surface for a single food.
 */
async function previewIfMealShaped(q: string, mealKind: MealKind): Promise<MealPreview | null> {
  if (!looksLikeMultiItemMeal(q)) return null;
  try {
    const p = await previewMeal(q, mealKind);
    return p.items.length >= 2 ? p : null;
  } catch {
    return null;
  }
}

/**
 * Two reads of the same meal, joined. Items concatenate (capped at the parser's own limit),
 * macro totals add up, and the raw text keeps both halves so the log still holds the user's own
 * words for everything on it. Confidence takes the LOWER of the two — a meal is only as certain
 * as its least certain part.
 */
export function mergePreviews(base: MealPreview, more: MealPreview): MealPreview {
  const addMacros = (a: MealPreview['macros'], b: MealPreview['macros']): MealPreview['macros'] => {
    if (!a) return b;
    if (!b) return a;
    const out: Record<string, number> = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const av = (a as Record<string, unknown>)[k];
      const bv = (b as Record<string, unknown>)[k];
      if (typeof av === 'number' || typeof bv === 'number') {
        out[k] = (typeof av === 'number' ? av : 0) + (typeof bv === 'number' ? bv : 0);
      }
    }
    return out as MealPreview['macros'];
  };
  return {
    ...base,
    items: [...base.items, ...more.items].slice(0, 12),
    macros: addMacros(base.macros, more.macros),
    confidence:
      base.confidence != null && more.confidence != null
        ? Math.min(base.confidence, more.confidence)
        : (base.confidence ?? more.confidence),
    flags: { ...base.flags, ...more.flags },
    raw_text: `${base.raw_text}; ${more.raw_text}`.slice(0, 500),
  };
}

/**
 * One more thing for a meal already on the card: parse the new words alone, then merge. A meal is
 * almost always several things (owner, 2026-08-15), so the card grows rather than making someone
 * log twice and hope the day adds up. Null when the words were unreadable — the caller says so
 * and the existing meal is left exactly as it was.
 */
async function growMealPreview(base: MealPreview, q: string, mealKind: MealKind): Promise<MealPreview | null> {
  const more = await previewMeal(q, mealKind).catch(() => null);
  return more?.items.length ? mergePreviews(base, more) : null;
}

export function useMealCapture(
  detail: OccurrenceDetail,
  setDetail: (d: OccurrenceDetail) => void,
  opts: { onLogged?: () => void; onClose?: () => void },
) {
  const [mealKind, setMealKind] = useState<MealKind>(mealFromTitle(detail.title) ?? mealForNow());
  const [recents, setRecents] = useState<FoodSummary[]>([]);
  const [recentsStatus, setRecentsStatus] = useState<'loading' | 'ok' | 'empty' | 'unavailable'>('loading');
  const [draft, setDraft] = useState<FoodDraft | null>(null);
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [plateAdvice, setPlateAdvice] = useState<PlateAdvice | null>(null);
  const [advising, setAdvising] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logErr, setLogErr] = useState('');

  const { data: day = null, refetch } = useNutritionDay(detail.date);
  const invalidateNutritionDay = useInvalidateNutritionDay();

  async function refreshDay() {
    await invalidateNutritionDay();
    await refetch();
  }

  useEffect(() => {
    let alive = true;
    getFoodRecents().then((r) => {
      if (!alive) return;
      if (r.status === 'unavailable') return setRecentsStatus('unavailable');
      setRecents(r.foods.slice(0, 4));
      setRecentsStatus(r.foods.length ? 'ok' : 'empty');
    });
    return () => {
      alive = false;
    };
  }, [detail.occurrence_id]);

  const [mealPreview, setMealPreview] = useState<MealPreview | null>(null);

  function markLogged() {
    if (detail.status === 'pending') setDetail({ ...detail, status: 'done' });
    opts.onLogged?.();
    opts.onClose?.();
  }

  const plateApi = usePlate({ draft, setDraft, busy, setBusy, setLogErr, mealKind, refreshDay, markLogged });

  /**
   * Words → the right pipeline. A multi-ingredient description goes to the meal parser (the
   * quantities in the text ARE the servings — no portion question); a single food goes to the
   * resolver as ever. `forceSingle` is the card's "just one food?" escape hatch, because the
   * split is a heuristic and the user is the tiebreak.
   */
  async function resolveText(text: string, opts2?: { forceSingle?: boolean; addTo?: MealPreview }) {
    const q = text.trim();
    if (!q || resolving) return;
    setResolving(true);
    setNote('');
    setLogErr('');
    try {
      if (opts2?.addTo) {
        const grown = await growMealPreview(opts2.addTo, q, mealKind);
        if (!grown) return setNote("Couldn't read that one — try saying it a different way.");
        return setMealPreview(grown);
      }
      const preview = opts2?.forceSingle ? null : await previewIfMealShaped(q, mealKind);
      if (preview) return setMealPreview(preview);
      const { draft: d, note: n } = await resolveToDraft(q, mealKind);
      if (d) setDraft(d);
      else if (n) setNote(n);
    } finally {
      setResolving(false);
    }
  }

  /** A two-tap recent / saved food → its draft card with the resolver's portion prefill. */
  async function pickSaved(foodId: string, portion?: FoodDraftPortion) {
    setNote('');
    setLogErr('');
    const found = await getFoodById(foodId);
    if (found.status !== 'ok' || !found.food) return setNote("Couldn't open that one — say it or snap it fresh.");
    setDraft({ kind: 'saved', food: found.food, ...portion });
  }

  async function pickPhoto(file: File | null | undefined) {
    if (!file || busy) return;
    setLogErr('');
    try {
      setPhoto(await downscalePhoto(file));
      setPlateAdvice(null);
    } catch {
      setLogErr("Couldn't read that photo — try a different one.");
    }
  }

  function clearPhoto() {
    setPhoto(null);
    setPlateAdvice(null);
  }

  /** Pre-eat read — from the picked plate, or from a meal they described. Advice only, writes
   *  nothing. `meal` is how the TYPED path asks: the read used to live behind the camera alone,
   *  so anyone who wrote their meal out had no way to get one (owner, 2026-08-15). */
  async function checkPlate(meal?: string) {
    if ((!photo && !meal?.trim()) || advising) return;
    setAdvising(true);
    setLogErr('');
    try {
      const a = await getPlateAdvice(photo ? { photo } : { meal: meal!.trim() });
      if (a) setPlateAdvice(a);
      else setLogErr("Couldn't get a read on that plate — try again.");
    } finally {
      setAdvising(false);
    }
  }

  /**
   * The photo path no longer logs from here (A23 / 2026-08-22): `MealCapturePhoto` runs the same
   * read-then-confirm panel the Food tab uses, and the row is written by the user's confirm inside
   * it. What is left for this hook is the bookkeeping that follows — refresh the day, tick the task.
   */
  async function afterPhotoLogged() {
    clearPhoto();
    await refreshDay();
    markLogged();
  }

  async function logDraft(portion: DraftPortion) {
    if (!draft || busy) return;
    setBusy(true);
    setLogErr('');
    try {
      const { ok, err } = await commitDraft(draft, portion);
      if (!ok) return setLogErr(err ?? "Couldn't log that just now — try again in a moment.");
      await refreshDay();
      markLogged();
    } finally {
      setBusy(false);
    }
  }

  return {
    ...plateApi,
    mealKind,
    mealPreview,
    setMealPreview,
    markLogged,
    setMealKind,
    day,
    recents,
    recentsStatus,
    draft,
    setDraft,
    resolving,
    note,
    photo,
    plateAdvice,
    advising,
    busy,
    logErr,
    resolveText,
    pickSaved,
    pickPhoto,
    clearPhoto,
    checkPlate,
    afterPhotoLogged,
    logDraft,
  };
}
