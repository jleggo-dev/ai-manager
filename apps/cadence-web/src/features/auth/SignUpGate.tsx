import { useEffect, useState } from 'react';
import { getPlan, type PlanViewData } from '../../lib/api.ts';
import { CoachFace } from '../../components/CoachFace.tsx';
import { PlanCardView } from '../gate/PlanCardView.tsx';
import { AuthScreen } from './AuthScreen.tsx';

/**
 * "Here's the rhythm I'd build — and why." The pre-signup plan card (design: Cadence Plan Card
 * Gate), replacing the old "Your first week is ready. Save it."
 *
 * The gate OFFERS, it doesn't charge: her plan, her reasoning (the plan-level rationale as her
 * speech bubble, per-activity whys as quoted insets), and the sign-in framed as "we'll talk it
 * through". The plan already exists server-side against the anonymous id — signing up upgrades
 * that id in place, so nothing is migrated at the moment of saying yes.
 *
 * Layout: the plan scrolls; the auth block is a pinned footer, so the offer and the way to take
 * it are both always on screen. Sparse plans (≤2 activities) arrive with all reasoning open —
 * when the plan is one row, the reasoning IS the content.
 */
export function SignUpGate() {
  const [plan, setPlan] = useState<PlanViewData | null>(null);

  useEffect(() => {
    getPlan()
      .then(setPlan)
      .catch(() => {
        /* the gate stands on its own; the card is the offer, not a precondition */
      });
  }, []);

  return (
    <div className="gate2">
      <div className="gate2-scroll">
        <div className="gate-h">Here&rsquo;s the rhythm I&rsquo;d build — and why.</div>
        {plan && <PlanCardView plan={plan} />}
      </div>
      <div className="gate2-foot">
        <div className="gate2-say">
          <CoachFace size={20} ring={false} />
          <span>Sign in and we&rsquo;ll talk it through — push back on any of it.</span>
        </div>
        <AuthScreen mode="upgrade" compact />
        {/* Honest, and only what is true: the draft is reachable only through this device's
            anonymous session. No expiry is stated because none is implemented — the design's
            7-day-expiry line is an open proposal (PLAN.md), not a shipped behaviour. */}
        <div className="gate2-draft">No account needed yet — this draft lives only on this phone.</div>
      </div>
    </div>
  );
}
