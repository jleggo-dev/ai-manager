import { useEffect, useState } from 'react';
import {
  getPendingChangeDetail,
  setPendingChangeToggles,
  applyPendingChange,
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
  const [removed, setRemoved] = useState<string[]>([]);
  const [enabled, setEnabled] = useState<Record<number, boolean>>({});
  const [applyState, setApplyState] = useState<WeekChangesApplyState>('idle');
  /** The server's own words for a refused apply, when it gave any. */
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void getPendingChangeDetail()
      .then((d) => {
        if (!alive) return;
        // An older API answers without `removed`; read it as nothing dropped.
        const dropped = d.removed ?? [];
        if (!d.items.length && !dropped.length) {
          setState('unavailable');
          return;
        }
        setPlanVersion(d.plan_version);
        setItems(d.items);
        setRemoved(dropped);
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

  /** Drops count too: they apply with the rest and have no toggle to turn them off. */
  const enabledCount = items.filter((i) => enabled[i.index]).length + removed.length;

  /**
   * Toggles first, THEN the same applyPendingChange() ChangeCard's own Apply runs — in that order,
   * because the funnel (confirmPendingPlan → resolveToggledActivities) reads whatever `enabled`
   * values are on the stored proposal at the moment it commits. Posting the flips after the lock
   * would commit against stale state.
   */
  async function apply(): Promise<boolean> {
    setApplyState('applying');
    setApplyError(null);
    try {
      const toggles = items.map((i) => ({ index: i.index, enabled: !!enabled[i.index] }));
      const saved = await setPendingChangeToggles(toggles);
      if (!saved) {
        setApplyState('failed');
        return false;
      }
      const applied = await applyPendingChange();
      if (!applied.ok) {
        setApplyError(applied.message);
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

  return { state, planVersion, items, removed, enabled, toggle, enabledCount, applyState, applyError, apply };
}
