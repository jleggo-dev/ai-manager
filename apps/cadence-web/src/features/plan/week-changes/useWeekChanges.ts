import { useEffect, useState } from 'react';
import {
  getPendingChangeDetail,
  setPendingChangeToggles,
  lockPlan,
  type PendingChangeDetailItem,
} from '../../../lib/api.ts';

export type WeekChangesLoadState = 'loading' | 'ready' | 'unavailable';
export type WeekChangesApplyState = 'idle' | 'applying' | 'applied' | 'failed';

/**
 * The Changes sheet's one read (getPendingChangeDetail on mount, same one-shot shape
 * useWeekReview.ts already uses) plus the LOCAL toggle state the sheet lets the user flip before
 * applying — nothing is persisted server-side until `apply()` runs.
 *
 * `enabled` is keyed by each item's stored `index`, not array position in a local list, so a flip
 * survives however the items happen to be rendered and maps 1:1 onto what
 * POST /plan/pending-change/toggles expects.
 */
export function useWeekChanges() {
  const [state, setState] = useState<WeekChangesLoadState>('loading');
  const [planVersion, setPlanVersion] = useState<number | null>(null);
  const [items, setItems] = useState<PendingChangeDetailItem[]>([]);
  const [enabled, setEnabled] = useState<Record<number, boolean>>({});
  const [applyState, setApplyState] = useState<WeekChangesApplyState>('idle');

  useEffect(() => {
    let alive = true;
    void getPendingChangeDetail()
      .then((d) => {
        if (!alive) return;
        if (!d.items.length) {
          setState('unavailable');
          return;
        }
        setPlanVersion(d.plan_version);
        setItems(d.items);
        setEnabled(Object.fromEntries(d.items.map((i) => [i.index, i.enabled])));
        setState('ready');
      })
      .catch(() => {
        if (alive) setState('unavailable');
      });
    return () => {
      alive = false;
    };
  }, []);

  function toggle(index: number) {
    setEnabled((prev) => ({ ...prev, [index]: !prev[index] }));
  }

  const enabledCount = items.filter((i) => enabled[i.index]).length;

  /**
   * Toggles first, THEN the same lockPlan() ChangeCard's own Apply already runs — in that order,
   * because the funnel (confirmPendingPlan → resolveToggledActivities) reads whatever `enabled`
   * values are on the stored proposal at the moment it commits. Posting the flips after the lock
   * would commit against stale state.
   */
  async function apply(): Promise<boolean> {
    setApplyState('applying');
    try {
      const toggles = items.map((i) => ({ index: i.index, enabled: !!enabled[i.index] }));
      const saved = await setPendingChangeToggles(toggles);
      if (!saved) {
        setApplyState('failed');
        return false;
      }
      const { status } = await lockPlan();
      if (status !== 200) {
        setApplyState('failed');
        return false;
      }
      setApplyState('applied');
      return true;
    } catch {
      setApplyState('failed');
      return false;
    }
  }

  return { state, planVersion, items, enabled, toggle, enabledCount, applyState, apply };
}
