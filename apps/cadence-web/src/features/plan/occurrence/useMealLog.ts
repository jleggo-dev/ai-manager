import { useEffect, useState } from 'react';
import {
  getNutritionDay,
  getRecentMeals,
  logMeal,
  patchMeal,
  type Meal,
  type MealKind,
  type NutritionDayData,
  type OccurrenceDetail,
} from '../../../lib/api.ts';
import { downscalePhoto, mealForNow } from './format.ts';

/**
 * Meal / nutrition observe-phase state: day rollup, photo downscale, confirm, and log submit.
 * Highest-blast-radius extract — structural move only; keep call order identical to the sheet.
 */
export function useMealLog(detail: OccurrenceDetail, setDetail: (d: OccurrenceDetail) => void, onLogged?: () => void) {
  const [mealText, setMealText] = useState('');
  const [mealKind, setMealKind] = useState<MealKind>(mealForNow());
  const [mealBusy, setMealBusy] = useState(false);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [mealPhoto, setMealPhoto] = useState<string | null>(null);
  const [day, setDay] = useState<NutritionDayData | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [daysLogged, setDaysLogged] = useState(0);
  const [logErr, setLogErr] = useState('');

  async function refreshDay(forDate?: string) {
    const d = await getNutritionDay(forDate).catch(() => null);
    if (d) {
      setDay(d);
      setMeals(d.meals);
    }
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
      const m = await logMeal(text, mealKind, mealPhoto ?? undefined);
      setMeals([m, ...meals]);
      setMealText('');
      setMealPhoto(null);
      void refreshDay(detail.date);
      if (detail.status === 'pending') setDetail({ ...detail, status: 'done' });
      onLogged?.();
    } catch {
      setLogErr("That didn't save — give it another try.");
    } finally {
      setMealBusy(false);
    }
  }

  // Food rows: the day rollup drives the list + totals; the 7d fetch only feeds the phase gate.
  useEffect(() => {
    let alive = true;
    void refreshDay(detail.date);
    getRecentMeals(7)
      .then((ms) => {
        if (alive) setDaysLogged(new Set(ms.map((m) => m.date)).size);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
