/**
 * The horizon's own marker (owner, 2026-08-31) — mid-week the trail just STOPPED: the last sky
 * ended, the detour line sat alone under it, and nothing said the week's edge is deliberate.
 * This end-cap names both halves of that edge: the weekly check-in lands where the trail ends
 * (DESIGN-check-in.md — reaching the horizon IS the check-in moment), and the one thing you can
 * do about the edge — see further — is an ask to the coach, sent VISIBLY (the same autoSend
 * idiom as "Start my check-in"), because a longer week is her grant (`extend_horizon`), not an
 * app setting. Renders only while the end-of-trail card is not up; the two never compete.
 */

import { endPhrase } from './end-phrase.ts';

/** Local calendar day — the end-cap's clock is the user's day, not UTC (PlanView's own rule). */
function localTodayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function HorizonEndCap({
  endsOn,
  canAskAhead,
  onPlanAhead,
}: {
  /** `weekState.ends_on` — absent (or unparseable) renders nothing. */
  endsOn?: string;
  /** False once the week already runs past 7 days — the ask would only earn "it already does". */
  canAskAhead: boolean;
  /** The visible "Can we plan two weeks ahead?" send — MainTabs' autoSend bridge. */
  onPlanAhead: () => void;
}) {
  const phrase = endPhrase(endsOn, localTodayIso());
  if (!phrase) return null;
  return (
    <div className="horizon-endcap">
      <p className="horizon-endcap-line">
        The trail ends where your week does — we&rsquo;ll have your weekly check-in {phrase}.
      </p>
      {canAskAhead && (
        <button className="horizon-endcap-ask" onClick={onPlanAhead}>
          Can we plan two weeks ahead?
        </button>
      )}
    </div>
  );
}
