import { useState } from 'react';
import type { WalkthroughStep } from '@cadence/shared';
import { CoachFace } from '../../../components/CoachFace.tsx';
import { isHerProposal, pickSteps, trimLine, type TrimProposal } from './trim.ts';

/**
 * Cadence's proposed cut, shown before anything starts, and the person's to change.
 *
 * Every step of the session is a row, in the session's own order, so a row stays where it is when
 * tapped. Tapping puts a step in or takes it out and the minutes follow. Her proposal is only where
 * the rows start: the person can keep what she cut and drop what she kept (owner, 2026-11-05).
 *
 * The cut steps stay listed BY NAME and struck through rather than simply vanishing from the plan.
 * A trim that quietly shortens the list leaves the person to notice later that their cool-down is
 * gone; naming it is what makes this something they chose rather than a change that happened to
 * them.
 *
 * "Trim more" is her next proposal, which would replace the rows, so it goes away once the person
 * has made the choice their own.
 */
export function StartTrim({
  steps,
  proposal,
  onConfirm,
  onTrimMore,
  onBack,
}: {
  /** Every step of the session, whatever the proposal cut. */
  steps: readonly WalkthroughStep[];
  proposal: TrimProposal;
  onConfirm: (pick: TrimProposal) => void;
  onTrimMore: () => void;
  onBack: () => void;
}) {
  const [keep, setKeep] = useState<ReadonlySet<string>>(() => new Set(proposal.kept.map((s) => s.id)));
  const pick = pickSteps(steps, keep);
  const hers = isHerProposal(proposal, keep);

  const toggle = (id: string) =>
    setKeep((now) => {
      const next = new Set(now);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="strim">
      <div className="sca-say">
        <CoachFace size={44} />
        <div className="sca-bubble">{trimLine(pick, hers)}</div>
      </div>

      <div className="strim-list">
        {steps.map((s) => {
          const on = keep.has(s.id);
          return (
            <button
              type="button"
              className={`strim-row${on ? '' : ' is-cut'}`}
              key={s.id}
              aria-pressed={on}
              onClick={() => toggle(s.id)}
            >
              <span className="strim-tick" aria-hidden>
                {on ? '✓' : ''}
              </span>
              <span className="strim-t">{s.title}</span>
              <span className="strim-m">{s.minutes} min</span>
            </button>
          );
        })}
      </div>

      <button className="ss-btn ss-start" disabled={pick.kept.length === 0} onClick={() => onConfirm(pick)}>
        Start · {pick.minutes} min
      </button>
      {proposal.canTrimMore && hers && (
        <button className="ss-btn ss-less" onClick={onTrimMore}>
          Still too much — trim more
        </button>
      )}
      <button className="ss-back" onClick={onBack}>
        ← keep it all
      </button>
    </div>
  );
}
