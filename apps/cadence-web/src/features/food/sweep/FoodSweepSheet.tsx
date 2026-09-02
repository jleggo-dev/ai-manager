/**
 * S3 — "Your week in food" (canvas frame S3; MEAL-LOGGING.md "The Sunday sweep").
 *
 * Each proposal is a bracket-marked block — the same mark as everywhere else: green rail for one
 * portion, butter for makes-several — with the deterministic evidence line ("Five mornings" is a
 * count, not an opinion) and a toggle. Every toggle starts ON; the user un-keeps. The only doors
 * out are ONE commit for the whole kept set, "None of these, thanks", and the ‹ (which keeps the
 * sweep pending for later — closing is not declining). Nothing here ever auto-applies.
 */
import { useState } from 'react';
import type { FoodSweepProposal, PendingFoodSweep } from '@cadence/shared';
import { numberWord } from '../bracket/copy.ts';
import { CoachLine } from './CoachLine.tsx';
import { noticeLine, S3_FOOTER, saveLine } from './copy.ts';

export interface FoodSweepSheetProps {
  sweep: PendingFoodSweep;
  /** True while the commit is in flight — both doors hold. */
  busy?: boolean;
  error?: string | null;
  /** The ‹ and the scrim: close the sheet, sweep stays pending. NOT a dismiss. */
  onBack: () => void;
  /** One commit for the toggled set (never per-proposal accepts). */
  onCommit: (acceptIds: string[]) => void;
  /** "None of these, thanks" — declines the whole sweep. */
  onDismiss: () => void;
}

function ProposalBlock({
  proposal,
  kept,
  onToggle,
}: {
  proposal: FoodSweepProposal;
  kept: boolean;
  onToggle: () => void;
}) {
  const butter = proposal.yield_servings > 1;
  return (
    <div className={`sw-prop${butter ? ' sw-prop--butter' : ''}${kept ? '' : ' sw-prop--off'}`}>
      <div className="sw-prop-main">
        <span className="sw-rail" aria-hidden />
        <div className="sw-prop-text">
          <div className="sw-prop-name">{proposal.name}</div>
          <div className="sw-prop-members">{proposal.members.map((m) => m.name).join(' · ')}</div>
          <div className="sw-prop-line">{proposal.line}</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={kept}
          aria-label={`Keep ${proposal.name}`}
          className={`sw-toggle${kept ? ' sw-toggle--on' : ''}`}
          onClick={onToggle}
        >
          <span className="sw-knob" aria-hidden />
        </button>
      </div>
      <div className="sw-save">{saveLine(proposal)}</div>
    </div>
  );
}

export function FoodSweepSheet({ sweep, busy, error, onBack, onCommit, onDismiss }: FoodSweepSheetProps) {
  // Default ON per proposal — the user un-toggles; the count in the commit door follows.
  const [kept, setKept] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(sweep.proposals.map((p) => [p.id, true])),
  );
  const keptIds = sweep.proposals.filter((p) => kept[p.id]).map((p) => p.id);
  return (
    <>
      <div className="sheet-scrim" onClick={onBack} aria-hidden />
      <div className="sheet sw-sheet" role="dialog" aria-label="Your week in food">
        <div className="sheet-grab" aria-hidden />
        <div className="sw-head">
          <button type="button" className="sw-back" aria-label="Back" onClick={onBack}>
            {'‹'}
          </button>
          <div className="sw-title">Your week in food</div>
        </div>
        <div className="sw-body">
          <CoachLine text={noticeLine(sweep.proposals.length)} />
          <div className="sw-label">WHAT I NOTICED</div>
          <div className="sw-props">
            {sweep.proposals.map((p) => (
              <ProposalBlock
                key={p.id}
                proposal={p}
                kept={kept[p.id] === true}
                onToggle={() => setKept((k) => ({ ...k, [p.id]: !k[p.id] }))}
              />
            ))}
          </div>
          <div className="sw-foot">{S3_FOOTER}</div>
          {error && <div className="sw-err">{error}</div>}
        </div>
        <div className="sw-actions">
          {keptIds.length > 0 && (
            <button type="button" className="sw-primary" disabled={busy} onClick={() => onCommit(keptIds)}>
              {`Add the ${numberWord(keptIds.length)} I've kept`}
            </button>
          )}
          <button type="button" className="sw-secondary" disabled={busy} onClick={onDismiss}>
            None of these, thanks
          </button>
        </div>
      </div>
    </>
  );
}
