import { useState } from 'react';
import { CHECKIN_ADJUSTMENT_OPTIONS, MOODS, type CheckinAdjustment, type MoodValue } from '@cadence/shared';
import { sendDailyCheckin } from '../../lib/api.ts';
import { CoachFace } from '../../components/CoachFace.tsx';
import { useDailyCheckinDue } from '../../lib/query/index.ts';
import { commitLabel } from './checkinCommit.ts';

/**
 * The daily check-in — Cadence's one unprompted moment.
 *
 * Everything about it is built to be easy to refuse. Both answers are optional and independent,
 * and the whole thing fires at most once a local day (the gate lives server-side in
 * services/daily-checkin.ts, since it turns on the user's timezone and on whether yesterday
 * actually had a plan).
 *
 * ONE BUTTON under the list (owner, 2026-09-08: "there's no way to accept what I've chosen").
 * With nothing picked it is the quiet "Not now — take me to today". Pick a mood or "Keep the
 * week as is" and it becomes "Done"; pick "Make it lighter" and it becomes "Next", because that
 * pick is the START of a conversation — the steer goes to the coach, who shows the change before
 * anything moves (Phase 2, PLAN-CHANGES.md). Nothing is sent on a tap; the button commits.
 *
 * It asks how yesterday FELT and does not narrate what happened in it. Cadence could recite the
 * day back, but a recap the user didn't ask for, delivered before they've had coffee, reads as a
 * report card — and the mood answer is the only part that feeds anything.
 */

export function DailyCheckIn({
  onAdjust,
  onCoach,
  onClose,
}: {
  /** Hand the pick's steer to the coach (PlanView routes it as a visible send — Phase 2). */
  onAdjust: (steer: string) => void;
  onCoach: () => void;
  onClose: () => void;
}) {
  const [mood, setMood] = useState<MoodValue | null>(null);
  const [picked, setPicked] = useState<CheckinAdjustment | null>(null);

  // Through the cache (PERF-03) rather than a fetch per mount: the gate is once per local day and
  // lives server-side, so re-asking on every Plan-tab return could never change the answer.
  const due = useDailyCheckinDue();
  if (!due) return null;

  const nothingPicked = mood == null && picked == null;
  const label = commitLabel(mood, picked);

  /** "Not now" — also what tapping the scrim means. Writes today's row so it never re-asks. */
  const dismiss = () => {
    void sendDailyCheckin({ dismissed: true });
    onClose();
  };

  const commit = () => {
    if (nothingPicked) return dismiss();
    const opt = picked ? CHECKIN_ADJUSTMENT_OPTIONS.find((o) => o.code === picked) : null;
    void sendDailyCheckin({ mood, adjustment: picked });
    // "Keep as is" (or a mood alone) is the end of the conversation. A steer is the start of one —
    // it goes to the coach, because an adjustment the user never saw isn't one they agreed to.
    if (opt?.steer) onAdjust(opt.steer);
    else onClose();
  };

  return (
    <>
      <div className="sheet-scrim" onClick={dismiss} aria-hidden />
      <div className="sheet dci" role="dialog" aria-label="Daily check-in">
        <div className="sheet-grab" aria-hidden />

        <div className="sca-say">
          <CoachFace size={52} />
          <div className="sca-bubble">{'Morning. Before today gets going — how did yesterday feel?'}</div>
        </div>

        <div className="dci-moods" role="radiogroup" aria-label="How yesterday felt">
          {MOODS.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={mood === m.value}
              className={`dci-mood${mood === m.value ? ' is-on' : ''}`}
              onClick={() => setMood((cur) => (cur === m.value ? null : m.value))}
            >
              <span className={`dci-dot dci-dot-${m.value}`} aria-hidden />
              <span className="dci-moodl">{m.label}</span>
            </button>
          ))}
        </div>

        <div className="dci-k">WANT ME TO ADJUST THE WEEK?</div>
        <div className="dci-opts" role="radiogroup" aria-label="Adjust the week">
          {CHECKIN_ADJUSTMENT_OPTIONS.map((o) => (
            <button
              key={o.code}
              type="button"
              role="radio"
              aria-checked={picked === o.code}
              className={`dci-opt${picked === o.code ? ' is-on' : ''}`}
              onClick={() => setPicked((cur) => (cur === o.code ? null : o.code))}
            >
              <span className="dci-optt">
                <b>{o.label}</b>
              </span>
              <span className="dci-radio" aria-hidden />
            </button>
          ))}
          <button type="button" className="dci-opt dci-talk" onClick={onCoach}>
            <CoachFace size={32} />
            <span className="dci-optt">
              <b>Talk to me about it</b>
            </span>
          </button>
        </div>

        {nothingPicked ? (
          <button type="button" className="dci-not" onClick={commit}>
            {label}
          </button>
        ) : (
          <button type="button" className="dci-commit" onClick={commit}>
            {label}
          </button>
        )}
      </div>
    </>
  );
}
