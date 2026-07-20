import { useState } from 'react';
import { getBaselineRead, setMacroTargets, type BaselineRead, type MealMacros } from '../../../lib/api.ts';

/** Baseline moment + coach-proposed macro targets (suggest-never-auto-apply). */
export function useNutritionBaseline(refreshDay: (forDate?: string) => Promise<void>, detailDate?: string) {
  const [baseline, setBaseline] = useState<BaselineRead | null>(null);
  const [baselineBusy, setBaselineBusy] = useState(false);
  const [targetsBusy, setTargetsBusy] = useState(false);
  const [targetsSet, setTargetsSet] = useState(false);
  const [err, setErr] = useState('');

  async function applyTargets(t: MealMacros) {
    if (targetsBusy) return;
    setTargetsBusy(true);
    try {
      if (await setMacroTargets(t)) {
        setTargetsSet(true);
        await refreshDay(detailDate);
      }
    } finally {
      setTargetsBusy(false);
    }
  }

  async function fetchBaseline() {
    if (baselineBusy) return;
    setBaselineBusy(true);
    setErr('');
    try {
      setBaseline(await getBaselineRead());
    } catch {
      setErr("Couldn't put the read together just now — try again in a moment.");
    } finally {
      setBaselineBusy(false);
    }
  }

  return {
    baseline,
    baselineBusy,
    targetsBusy,
    targetsSet,
    err,
    fetchBaseline,
    applyTargets,
  };
}
