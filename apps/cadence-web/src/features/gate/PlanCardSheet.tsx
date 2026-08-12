import { useEffect, useState } from 'react';
import { getPlan, type PlanViewData } from '../../lib/api.ts';
import { PlanCardView } from './PlanCardView.tsx';

/**
 * The plan card as a SHEET over the coach conversation — the deterministic "show the plan" the
 * coach tab owns (owner, 2026-08-12: display the crafted UI when we know a plan was built, "with
 * a toggle back to the chat"). Fetches fresh on every open, because the moments that open it —
 * a rebuild just committed, the walkthrough discussing the week — are exactly the moments a
 * cached plan would be the OLD plan.
 */
export function PlanCardSheet({ onClose }: { onClose: () => void }) {
  const [plan, setPlan] = useState<PlanViewData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getPlan()
      .then(setPlan)
      .catch(() => setFailed(true));
  }, []);

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="sheet plan-sheet" role="dialog" aria-label="Your week, and why">
        <div className="sheet-grab" aria-hidden />
        <div className="sheet-head">
          <div className="sheet-title">
            <b>Your week — and why</b>
          </div>
          <button className="sheet-x" onClick={onClose} aria-label="Back to the chat">
            ×
          </button>
        </div>
        <div className="sheet-body plan-sheet-body">
          {plan && <PlanCardView plan={plan} />}
          {failed && <div className="sess-note">Couldn&rsquo;t load the plan just now — the chat still works.</div>}
        </div>
      </div>
    </>
  );
}
