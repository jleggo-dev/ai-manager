import { useEffect, useState } from 'react';
import {
  createFood,
  estimateFood,
  getFoodById,
  getFoodRecents,
  getPlateAdvice,
  logMeal,
  logMealFromFood,
  portionHintFromResolve,
  resolveFoods,
  type FoodSummary,
  type MealKind,
  type OccurrenceDetail,
  type PlateAdvice,
} from '../../../lib/api.ts';
import { useInvalidateNutritionDay, useNutritionDay } from '../../../lib/query/index.ts';
import type { FoodDraft, FoodDraftPortion } from '../../food/foodDraft.ts';
import { downscalePhoto, mealForNow, mealFromTitle } from './format.ts';

export interface DraftPortion {
  servingIndex: number;
  quantity: number;
  meal: MealKind;
  name: string;
  brand: string;
}

/**
 * Words (say / type) → the deterministic resolver → a single draft card. A clear best match (or the
 * top saved food) becomes the draft with its portion prefill; otherwise we estimate a fresh
 * candidate, still confirm-first. Pure API orchestration, no React state, so the hook stays lean.
 */
async function resolveToDraft(q: string): Promise<{ draft?: FoodDraft; note?: string }> {
  const r = await resolveFoods({ text: q });
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

/** A confirmed draft → deterministic log (real macros). Creates the food first if it was new. */
async function commitDraft(draft: FoodDraft, portion: DraftPortion): Promise<{ ok: boolean; err?: string }> {
  let foodId: string;
  if (draft.kind === 'saved') {
    foodId = draft.food.food_id;
  } else {
    const saved = await createFood({
      ...draft.candidate,
      name: portion.name.trim() || draft.candidate.name,
      brand: portion.brand.trim() || null,
      default_serving: portion.servingIndex,
    });
    if (!saved) return { ok: false, err: "Couldn't save that food just now — try again in a moment." };
    foodId = saved.food_id;
  }
  const logged = await logMealFromFood({
    food_id: foodId,
    meal: portion.meal,
    serving_index: portion.servingIndex,
    quantity: portion.quantity,
  });
  if (!logged) return { ok: false, err: "Couldn't log that just now — try again in a moment." };
  return { ok: true };
}

/**
 * The meal-capture engine behind the redesign sheet. Two honest paths, both reused from what already
 * ships: words → the resolver → a draft card you confirm (real macros); a photo → the provisional
 * `logMeal` path (logs now, stays dashed/out of totals until confirmed, so capture never blocks on
 * the model's confidence). The day rollup drives the two-tone rings; recents feed the two-tap pills.
 * A meal ticks its occurrence server-side, so a log just refreshes the trail and closes the sheet.
 */
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

  function markLogged() {
    if (detail.status === 'pending') setDetail({ ...detail, status: 'done' });
    opts.onLogged?.();
    opts.onClose?.();
  }

  async function resolveText(text: string) {
    const q = text.trim();
    if (!q || resolving) return;
    setResolving(true);
    setNote('');
    setLogErr('');
    try {
      const { draft: d, note: n } = await resolveToDraft(q);
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

  /** Pre-eat read on the picked plate — advice only, writes nothing. */
  async function checkPlate() {
    if (!photo || advising) return;
    setAdvising(true);
    setLogErr('');
    try {
      const a = await getPlateAdvice(photo);
      if (a) setPlateAdvice(a);
      else setLogErr("Couldn't get a read on that plate — try again.");
    } finally {
      setAdvising(false);
    }
  }

  /** Photo (± a few words) → provisional meal — logs now, confirmable later in Today's food. */
  async function logPhoto(caption: string) {
    if (!photo || busy) return;
    setBusy(true);
    setLogErr('');
    try {
      await logMeal(caption.trim(), mealKind, photo);
      await refreshDay();
      markLogged();
    } catch {
      setLogErr("That didn't save — give it another try.");
    } finally {
      setBusy(false);
    }
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
    mealKind,
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
    logPhoto,
    logDraft,
  };
}
