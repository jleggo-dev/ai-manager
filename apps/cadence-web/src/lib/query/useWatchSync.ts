import { useEffect, useRef } from 'react';
import type { PlanViewData } from '../api.ts';
import { getWatchWeek } from '../api.ts';
import { capabilities } from '../capability/index.ts';

/**
 * Keep the wrist's copy of the week current (W2 — the sync slice).
 *
 * **What decides a push is the plan's identity, not a timer.** The signature below changes when
 * the week actually changes — a commit, a replan, a detour, a session ticked off, the date
 * rolling over — and only then is anything fetched or sent. A polling sync would spend a network
 * round trip and a WatchConnectivity transfer every interval to re-send a week nobody touched.
 *
 * Everything degrades to doing nothing: web build, no plugin, no paired watch, our app not
 * installed on it, a failed fetch. The phone's own screens never depend on this having worked,
 * which is what makes silence the right failure — the wrist keeps the last week it was given
 * rather than being handed an empty one.
 */

/**
 * What "the week changed" means, as one comparable string.
 *
 * Version and commit stamp catch a replan; the per-occurrence status catches the ordinary case of
 * finishing something, which changes what the wrist should show without touching the plan itself.
 * The date is in there because a week that is identical in content is still a DIFFERENT week to a
 * wrist once midnight passes — today's row has to move.
 */
export function planSignature(plan: PlanViewData | undefined): string | null {
  if (!plan?.hasPlan || !Array.isArray(plan.week) || plan.week.length === 0) return null;
  const rows = plan.week.flatMap((d) => d.occurrences.map((o) => `${d.date}:${o.occurrence_id}:${o.status}`)).join(',');
  return [plan.stage, plan.version ?? '', plan.committedAt ?? '', plan.week[0]?.date ?? '', rows].join('|');
}

export function useWatchSync(plan: PlanViewData | undefined): void {
  const signature = planSignature(plan);
  /** The last signature actually delivered. A failed push leaves it unchanged, so the next real
   *  plan change retries rather than the failure being remembered as success. */
  const delivered = useRef<string | null>(null);

  useEffect(() => {
    if (!signature || signature === delivered.current) return;
    if (!capabilities.watchSync.isAvailable()) return;

    let cancelled = false;
    void (async () => {
      const state = await capabilities.watchSync.getState();
      // Not paired, or our app is not on the watch: there is nothing on the other end. This is an
      // answer, not an error — and it must not mark the signature delivered, so pairing a watch
      // later syncs on the next plan change rather than never.
      if (cancelled || !state.supported || !state.paired || !state.installed) return;

      const payload = await getWatchWeek();
      if (cancelled || !payload) return;

      const ok = await capabilities.watchSync.push(payload);
      if (!cancelled && ok) delivered.current = signature;
    })();

    return () => {
      cancelled = true;
    };
  }, [signature]);
}
