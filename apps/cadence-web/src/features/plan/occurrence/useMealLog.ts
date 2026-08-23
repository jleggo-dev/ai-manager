import { useEffect, useState } from 'react';
import {
  getRecentMeals,
  logMeal,
  patchMeal,
  getPlateAdvice,
  type Meal,
  type MealKind,
  type OccurrenceDetail,
  type PlateAdvice,
  deleteMeal,
} from '../../../lib/api.ts';
import { useInvalidateNutritionDay, useNutritionDay } from '../../../lib/query/index.ts';
import { downscalePhoto, mealForNow, mealFromTitle } from './format.ts';

/**
 * Meal / nutrition observe-phase state: day rollup, photo downscale, confirm, and log submit.
 * Day rollup comes from the shared TanStack nutrition-day query (CROSS-03); mutations invalidate
 * that key so Today / Settings refresh without a duplicate fetch path.
 */
export function useMealLog(detail: OccurrenceDetail, setDetail: (d: OccurrenceDetail) => void, onLogged?: () => void) {
  const [mealText, setMealText] = useState('');
  // A split task names its meal ("Log breakfast"); a generic "Food log" falls back to the clock.
  const [mealKind, setMealKind] = useState<MealKind>(mealFromTitle(detail.title) ?? mealForNow());
  const [mealBusy, setMealBusy] = useState(false);
  const [mealPhoto, setMealPhoto] = useState<string | null>(null);
  const [plateAdvice, setPlateAdvice] = useState<PlateAdvice | null>(null);
  const [advising, setAdvising] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [daysLogged, setDaysLogged] = useState(0);
  const [logErr, setLogErr] = useState('');

  /** Clear the picked photo AND any pre-eat advice it produced. */
  function clearPhoto() {
    setMealPhoto(null);
    setPlateAdvice(null);
  }

  /** Pre-eat "should I?" read on the picked plate — advice only, logs nothing. */
  async function checkPlate() {
    if (!mealPhoto || advising) return;
    setAdvising(true);
    setLogErr('');
    try {
      const a = await getPlateAdvice({ photo: mealPhoto });
      if (a) setPlateAdvice(a);
      else setLogErr("Couldn't get a read on that plate — try again.");
    } catch {
      setLogErr('Something hiccuped reading the plate — try again.');
    } finally {
      setAdvising(false);
    }
  }

  const { data: day = null, refetch } = useNutritionDay(detail.date);
  const invalidateNutritionDay = useInvalidateNutritionDay();
  const meals: Meal[] = day?.meals ?? [];

  async function refreshDay(_forDate?: string) {
    await invalidateNutritionDay();
    await refetch();
  }

  async function confirmMeal(logId: string) {
    if (confirming) return;
    setConfirming(logId);
    try {
      await patchMeal(logId, { confirm: true });
      await refreshDay(detail.date);
    } finally {
      setConfirming(null);
    }
  }

  async function pickPhoto(file: File | null | undefined) {
    if (!file || mealBusy) return;
    setLogErr('');
    try {
      setMealPhoto(await downscalePhoto(file));
      setPlateAdvice(null); // a fresh photo invalidates prior advice
    } catch {
      setLogErr("Couldn't read that photo — try a different one.");
    }
  }

  /** Words only. A photo takes the read-then-confirm path and is logged by `PhotoReadPanel`. */
  async function submitMeal() {
    const text = mealText.trim();
    if (!text || mealBusy) return;
    setMealBusy(true);
    setLogErr('');
    try {
      await logMeal(text, mealKind);
      setMealText('');
      setPlateAdvice(null);
      await refreshDay(detail.date);
      if (detail.status === 'pending') setDetail({ ...detail, status: 'done' });
      onLogged?.();
    } catch {
      setLogErr("That didn't save — give it another try.");
    } finally {
      setMealBusy(false);
    }
  }

  /**
   * Take a meal back off the day. For one that did not happen — a mis-tap, a double log, a parse
   * that invented a food. A meal that happened and was written down wrong is a correction instead.
   */
  async function removeLoggedMeal(logId: string) {
    if (mealBusy) return;
    setMealBusy(true);
    setLogErr('');
    try {
      const ok = await deleteMeal(logId);
      if (!ok) return setLogErr("Couldn't remove that one — try again in a moment.");
      await refreshDay(detail.date);
    } finally {
      setMealBusy(false);
    }
  }

  /** What follows a confirm inside the photo panel: clear the composer, refresh, tick the task. */
  async function afterPhotoLogged() {
    setMealText('');
    setMealPhoto(null);
    setPlateAdvice(null);
    await refreshDay(detail.date);
    if (detail.status === 'pending') setDetail({ ...detail, status: 'done' });
    onLogged?.();
  }

  // 7d fetch only feeds the baseline phase gate (not the shared day rollup).
  useEffect(() => {
    let alive = true;
    getRecentMeals(7)
      .then((ms) => {
        if (alive) setDaysLogged(new Set(ms.map((m) => m.date)).size);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [detail.occurrence_id]);

  return {
    mealText,
    setMealText,
    mealKind,
    setMealKind,
    mealBusy,
    meals,
    mealPhoto,
    setMealPhoto,
    clearPhoto,
    plateAdvice,
    advising,
    checkPlate,
    day,
    confirming,
    daysLogged,
    logErr,
    refreshDay,
    confirmMeal,
    pickPhoto,
    submitMeal,
    removeLoggedMeal,
    afterPhotoLogged,
  };
}
