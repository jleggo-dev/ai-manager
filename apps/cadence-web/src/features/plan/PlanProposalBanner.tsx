import { CoachFace } from '../../components/CoachFace.tsx';
import type { PlanViewData } from '../../lib/api.ts';

type Proposal = NonNullable<PlanViewData['pendingProposal']>;

/** Coach proposal banner — accept/dismiss; suggest-never-auto-apply. */
export function PlanProposalBanner({
  proposal,
  busy,
  working = false,
  onAccept,
  onDismiss,
}: {
  proposal: Proposal;
  busy: boolean;
  /**
   * The accepted rework is running server-side (accept answered 202 — PLAN-CHANGES.md Phase 0):
   * the buttons give way to one working line. The run survives the app closing, so the line says
   * so; a push lands on success or failure either way.
   */
  working?: boolean;
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
      {/* Her face, not the mark: the reason line is the coach's own suggestion in her voice, and
          this banner can share a screen with PlanAdjustNote below — one speaker, one face
          (CoachFace.tsx: no screen shows both). */}
      <CoachFace size={28} ring={false} />
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
        {working ? (
          // Inherits `.plan-proposal-t span` — her dim one-liner voice; no new CSS needed.
          <span role="status" style={{ marginTop: 8 }}>
            Reworking your week — you can leave the app, I&rsquo;ll let you know when it&rsquo;s set.
          </span>
        ) : (
          <div className="proposal-actions">
            <button className="proposal-accept" onClick={onAccept} disabled={busy}>
              {acceptLabel}
            </button>
            <button className="proposal-dismiss" onClick={onDismiss} disabled={busy}>
              Not now
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Short note after a plan adjust lands — HER note, so HER face and HER voice.
 *
 * This carried the Orb and a third-person header ("Your coach adjusted your plan") until the
 * owner met it on device (2026-08-31): the body is the coach speaking ("You said you're ready to
 * jump back in…"), and CoachFace.tsx's own rule says the face goes wherever Cadence speaks in
 * the first person — the mark is for where the PRODUCT speaks. The header now speaks as her too,
 * and works for both routes here: a week she drew that the user applied, and a coach-driven
 * commit.
 */
export function PlanAdjustNote({ note, onDismiss }: { note: string; onDismiss: () => void }) {
  return (
    <div className="plan-note">
      <CoachFace size={28} ring={false} />
      <div className="plan-note-t">
        <b>Here&rsquo;s what I changed</b>
        <span>{note}</span>
      </div>
      <button className="plan-note-x" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
