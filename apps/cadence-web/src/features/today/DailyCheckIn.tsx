import { useState } from 'react';
import { CHECKIN_ADJUSTMENT_OPTIONS, MOODS, type CheckinAdjustment, type MoodValue } from '@cadence/shared';
import { sendDailyCheckin } from '../../lib/api.ts';
import { CoachFace } from '../../components/CoachFace.tsx';
import { useDailyCheckinDue } from '../../lib/query/index.ts';

/**
 * The daily check-in — Cadence's one unprompted moment.
 *
 * Everything about it is built to be easy to refuse. Both answers are optional and independent,
 * "Not now" is a plain first-class button rather than a grey afterthought, and the whole thing
 * fires at most once a local day (the gate lives server-side in services/daily-checkin.ts, since
 * it turns on the user's timezone and on whether yesterday actually had a plan).
 *
 * The adjustment offers never mutate the week here. Picking one records the intent and hands the
 * matching steer to the ordinary suggest→preview→confirm flow, so the user still sees the
 * proposed week before anything moves — the one property that keeps a daily nudge from becoming
 * a thing that quietly rearranges your life while you're half awake.
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
  /** Hand a steer to the normal adjust flow. */
  onAdjust: (steer: string) => void;
  onCoach: () => void;
  onClose: () => void;
}) {
  const [mood, setMood] = useState<MoodValue | null>(null);
  const [picked, setPicked] = useState<CheckinAdjustment | null>(null);
  const [reply, setReply] = useState<string | null>(null);

  // Through the cache (PERF-03) rather than a fetch per mount: the gate is once per local day and
  // lives server-side, so re-asking on every Plan-tab return could never change the answer.
  const due = useDailyCheckinDue();
  if (!due) return null;

  const chooseMood = (m: MoodValue) => {
    setMood(m);
    void sendDailyCheckin({ mood: m });
  };

  const choose = (code: CheckinAdjustment) => {
    const opt = CHECKIN_ADJUSTMENT_OPTIONS.find((o) => o.code === code);
    if (!opt) return;
    setPicked(code);
    setReply(opt.reply);
    void sendDailyCheckin({ adjustment: code });
    // "Keep as is" is the end of the conversation. The other two are the START of one — they open
    // the preview, because an adjustment the user never saw isn't one they agreed to.
    if (opt.steer) {
      setTimeout(() => onAdjust(opt.steer), 600);
    }
  };

  const dismiss = () => {
    void sendDailyCheckin({ dismissed: true });
    onClose();
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
              onClick={() => chooseMood(m.value)}
            >
              <span className={`dci-dot dci-dot-${m.value}`} aria-hidden />
              <span className="dci-moodl">{m.label}</span>
            </button>
          ))}
        </div>

        <div className="dci-k">WANT ME TO ADJUST THE WEEK?</div>
        <div className="dci-opts">
          {CHECKIN_ADJUSTMENT_OPTIONS.map((o) => (
            <button
              key={o.code}
              className={`dci-opt${picked === o.code ? ' is-on' : ''}`}
              onClick={() => choose(o.code)}
            >
              <span className="dci-optt">
                <b>{o.label}</b>
                <span>{o.sub}</span>
              </span>
              <span className="dci-radio" aria-hidden />
            </button>
          ))}
          <button className="dci-opt dci-talk" onClick={onCoach}>
            <CoachFace size={32} />
            <span className="dci-optt">
              <b>Talk to me about it</b>
              <span>Vent, move things, or reshape the week in your own words</span>
            </span>
          </button>
        </div>

        {reply && (
          <div className="dci-reply">
            <CoachFace size={22} ring={false} />
            <p>{reply}</p>
          </div>
        )}

        <button className="dci-not" onClick={dismiss}>
          Not now — take me to today
        </button>
      </div>
    </>
  );
}
