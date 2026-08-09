import { useState } from 'react';
import {
  FELT_STATE_CHIPS,
  RPE_CHIPS,
  SKIP_REASON_CHIPS,
  type FeedbackChip,
  type SessionFeedback,
} from '@cadence/shared';
import { sendSessionFeedback } from '../../lib/api.ts';
import { CoachFace } from '../../components/CoachFace.tsx';
import type { SessionOutcome } from './sessionOutcome.ts';

/**
 * The post-session ask — one question, three chips, and Cadence's answer to whichever one you tap.
 *
 * Three things this deliberately does NOT do:
 *
 *  • It never blocks. "Done" is live from the first frame and finishing without answering is a
 *    completely normal exit — the celebration is the user's, not a toll gate for data.
 *  • It never asks what it already knows. `outcome.statement` reads back the rounds and steps
 *    from the session's own logs; the chips only capture the part no sensor can see.
 *  • It never re-asks. Tapping a chip replaces the question with Cadence's reply, and the reply
 *    names the concrete adjustment the answer caused — an answer that changes nothing wasn't
 *    worth interrupting someone for.
 *
 * The write is fire-and-forget. A failed POST must not cost someone their finished session, so
 * nothing here waits on it or reports it.
 */
export function SessionFeedbackCard({
  outcome,
  occurrenceId,
  onDone,
  onTalk,
}: {
  outcome: SessionOutcome;
  occurrenceId?: string | null;
  onDone: () => void;
  onTalk?: () => void;
}) {
  const [reply, setReply] = useState<string | null>(null);

  const chips: readonly FeedbackChip<string>[] =
    outcome.asks === 'felt_state' ? FELT_STATE_CHIPS : outcome.asks === 'reason' ? SKIP_REASON_CHIPS : RPE_CHIPS;

  const pick = (chip: FeedbackChip<string>) => {
    setReply(chip.reply);
    const payload: SessionFeedback & { occurrence_id?: string | null } = {
      kind: outcome.kind,
      occurrence_id: occurrenceId ?? null,
      ...(outcome.asks === 'felt_state'
        ? { felt_state: chip.code as SessionFeedback['felt_state'] }
        : outcome.asks === 'reason'
          ? { reason_code: chip.code as SessionFeedback['reason_code'] }
          : { rpe: chip.code as SessionFeedback['rpe'] }),
    };
    void sendSessionFeedback(payload);
  };

  return (
    <div className={`sfb${outcome.kind === 'mind' ? ' sfb-mind' : ''}`}>
      <div className="sfb-head">
        <CoachFace size={50} />
        <div className="sfb-headt">
          <b>{outcome.statement}</b>
          <span>{outcome.question}</span>
        </div>
      </div>

      {reply === null ? (
        <>
          <div className="sfb-chips">
            {chips.map((c) => (
              <button key={c.code} className="sfb-chip" onClick={() => pick(c)}>
                {c.label}
              </button>
            ))}
          </div>
          <div className="sfb-sub">
            {outcome.asks === 'reason' ? 'Optional — it just helps me plan better' : "The one thing I can't measure"}
          </div>
        </>
      ) : (
        <div className="sfb-reply">
          <CoachFace size={22} ring={false} />
          <p>{reply}</p>
        </div>
      )}

      <div className="sfb-actions">
        <button className="sfb-done" onClick={onDone}>
          Done
        </button>
        {onTalk && (
          <button className="sfb-talk" onClick={onTalk}>
            Talk to me
          </button>
        )}
      </div>
    </div>
  );
}
