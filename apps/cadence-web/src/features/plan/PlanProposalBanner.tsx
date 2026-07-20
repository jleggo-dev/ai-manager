import { Orb } from '../../components/Orb.tsx';
import type { PlanViewData } from '../../lib/api.ts';

type Proposal = NonNullable<PlanViewData['pendingProposal']>;

/** Coach proposal banner — accept/dismiss; suggest-never-auto-apply. */
export function PlanProposalBanner({
  proposal,
  busy,
  onAccept,
  onDismiss,
}: {
  proposal: Proposal;
  busy: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="plan-proposal">
      <Orb />
      <div className="plan-proposal-t">
        <b>Your coach has a suggestion</b>
        <span>{proposal.reason}</span>
        {proposal.suggested_levers.length > 0 && (
          <div className="proposal-levers">
            {proposal.suggested_levers.map((lever, i) => (
              <span className="lever-chip" key={i}>
                {lever}
              </span>
            ))}
          </div>
        )}
        <div className="proposal-actions">
          <button className="proposal-accept" onClick={onAccept} disabled={busy}>
            {busy ? 'Adjusting…' : 'Adjust my plan'}
          </button>
          <button className="proposal-dismiss" onClick={onDismiss} disabled={busy}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

/** Short note after a coach-driven plan adjust. */
export function PlanAdjustNote({ note, onDismiss }: { note: string; onDismiss: () => void }) {
  return (
    <div className="plan-note">
      <Orb />
      <div className="plan-note-t">
        <b>Your coach adjusted your plan</b>
        <span>{note}</span>
      </div>
      <button className="plan-note-x" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
