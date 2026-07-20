import { useEffect, useState } from 'react';
import {
  getRecentMeals,
  logMeal,
  patchMeal,
  type Meal,
  type MealKind,
  type OccurrenceDetail,
} from '../../../lib/api.ts';
import { useInvalidateNutritionDay, useNutritionDay } from '../../../lib/query/index.ts';
import { downscalePhoto, mealForNow } from './format.ts';

/**
 * Meal / nutrition observe-phase state: day rollup, photo downscale, confirm, and log submit.
 * Day rollup comes from the shared TanStack nutrition-day query (CROSS-03); mutations invalidate
 * that key so Today / Settings refresh without a duplicate fetch path.
 */
export function useMealLog(detail: OccurrenceDetail, setDetail: (d: OccurrenceDetail) => void, onLogged?: () => void) {
  const [mealText, setMealText] = useState('');
  const [mealKind, setMealKind] = useState<MealKind>(mealForNow());
  const [mealBusy, setMealBusy] = useState(false);
  const [mealPhoto, setMealPhoto] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [daysLogged, setDaysLogged] = useState(0);
  const [logErr, setLogErr] = useState('');

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
    } catch {
      setLogErr("Couldn't read that photo — try a different one.");
    }
  }

  async function submitMeal() {
    const text = mealText.trim();
    if ((!text && !mealPhoto) || mealBusy) return;
    setMealBusy(true);
    setLogErr('');
    try {
      await logMeal(text, mealKind, mealPhoto ?? undefined);
      setMealText('');
      setMealPhoto(null);
      await refreshDay(detail.date);
      if (detail.status === 'pending') setDetail({ ...detail, status: 'done' });
      onLogged?.();
    } catch {
      setLogErr("That didn't save — give it another try.");
    } finally {
      setMealBusy(false);
    }
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
    day,
    confirming,
    daysLogged,
    logErr,
    refreshDay,
    confirmMeal,
    pickPhoto,
    submitMeal,
  };
}
