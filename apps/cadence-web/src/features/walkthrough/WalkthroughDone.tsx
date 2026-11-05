import type { WalkthroughStep } from '@cadence/shared';
import { recapSummary, type StepLogs } from './state.ts';
import { sessionOutcome } from './sessionOutcome.ts';
import { SessionFeedbackCard } from './SessionFeedbackCard.tsx';

/**
 * The end of a session: the celebration, then the one thing Cadence couldn't measure.
 *
 * Order matters and is the whole design. The celebration lands FIRST and unconditionally — it
 * belongs to the person who just finished, and gating it behind a question would turn their
 * moment into a form. The ask sits underneath, already skippable.
 *
 * Mind sessions get the dark surface and the softer headline. A partial breath session is a
 * completed rep, so it is celebrated exactly as hard as a complete one — no dimmed tick, no
 * "almost", nothing that reads as a shortfall.
 *
 * Nothing is written until Done, so this screen is not the end of the road: Back returns to the
 * Recap with every log intact, for the person who got here by accident or spots a mistake.
 */
export function WalkthroughDone({
  steps,
  logs,
  title,
  occurrenceId,
  onBack,
  onFinish,
  onTalk,
}: {
  steps: WalkthroughStep[];
  logs: StepLogs;
  title: string;
  occurrenceId?: string | null;
  onBack: () => void;
  onFinish: () => void;
  onTalk?: () => void;
}) {
  const outcome = sessionOutcome(steps, logs);
  const mind = outcome.kind === 'mind';

  return (
    <div className={`wtdone${mind ? ' wtdone-mind' : ''}`} role="dialog" aria-label="Task complete">
      <button className="wtdone-back" onClick={onBack} aria-label="Back">
        ‹
      </button>
      <div className="wtdone-top">
        <div className="wtdone-tick" aria-hidden>
          ✓
        </div>
        <div className="wtdone-h">{mind ? 'That counts.' : 'Nice work!'}</div>
        <div className="wtdone-sum">{recapSummary(steps, logs) || `${title} complete`}</div>
      </div>

      <SessionFeedbackCard outcome={outcome} occurrenceId={occurrenceId} onDone={onFinish} onTalk={onTalk} />
    </div>
  );
}
