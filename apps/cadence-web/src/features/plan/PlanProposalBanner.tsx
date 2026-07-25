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
  // Each proposal action (Req 4) reads in its own voice — a detour, a welcome-back re-baseline, or
  // the original plan-adjust.
  const action = proposal.action ?? 'replan';
  const TITLE: Record<'replan' | 'enter_disrupted' | 'rebaseline', string> = {
    replan: 'Your coach has a suggestion',
    enter_disrupted: 'Life happened?',
    rebaseline: 'Welcome back',
  };
  const ACCEPT: Record<'replan' | 'enter_disrupted' | 'rebaseline', string> = {
    replan: 'Adjust my plan',
    enter_disrupted: 'Take a detour',
    rebaseline: 'Take a fresh look',
  };
  const BUSY: Record<'replan' | 'enter_disrupted' | 'rebaseline', string> = {
    replan: 'Adjusting…',
    enter_disrupted: 'Starting…',
    rebaseline: 'Taking a look…',
  };
  const title = TITLE[action];
  const acceptLabel = busy ? BUSY[action] : ACCEPT[action];

  return (
    <div className="plan-proposal">
      <Orb />
      <div className="plan-proposal-t">
        <b>{title}</b>
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
            {acceptLabel}
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
