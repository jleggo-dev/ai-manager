import { CoachFace } from '../../../components/CoachFace.tsx';
import type { TrimProposal } from './trim.ts';

/**
 * Cadence's proposed cut, shown before anything starts.
 *
 * The cut steps are listed BY NAME and struck through rather than simply vanishing from the plan.
 * A trim that quietly shortens the list leaves the person to notice later that their cool-down is
 * gone; naming it is what makes this a proposal they accepted rather than a change that happened
 * to them.
 */
export function StartTrim({
  proposal,
  onConfirm,
  onTrimMore,
  onBack,
}: {
  proposal: TrimProposal;
  onConfirm: () => void;
  onTrimMore: () => void;
  onBack: () => void;
}) {
  return (
    <div className="strim">
      <div className="sca-say">
        <CoachFace size={44} />
        <div className="sca-bubble">
          {`Here's what I'd drop — that brings it to ${proposal.minutes} min. Sound right?`}
        </div>
      </div>

      <div className="strim-list">
        {proposal.kept.map((s) => (
          <div className="strim-row" key={s.id}>
            <span className="strim-dot" aria-hidden />
            <span className="strim-t">{s.title}</span>
            <span className="strim-m">{s.minutes} min</span>
          </div>
        ))}
        {proposal.cut.map((s) => (
          <div className="strim-row is-cut" key={s.id}>
            <span className="strim-dot" aria-hidden />
            <span className="strim-t">{s.title}</span>
            <span className="strim-m">cut</span>
          </div>
        ))}
      </div>

      <button className="ss-btn ss-start" onClick={onConfirm}>
        Start · {proposal.minutes} min
      </button>
      {proposal.canTrimMore && (
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
