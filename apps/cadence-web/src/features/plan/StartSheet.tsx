import { useMemo, useState } from 'react';
import { deriveWalkthrough, type Walkthrough as WalkthroughData } from '@cadence/shared';
import { useOccurrenceDetail } from './occurrence/useOccurrenceDetail.ts';
import { coachingMessages, useRotatingMessage } from './coaching-progress.ts';
import { Walkthrough } from '../walkthrough/Walkthrough.tsx';
import { setOccurrence, logOccurrence } from '../../lib/api.ts';

// "I have less time" only earns its place on a real session — multi-step AND more than this many
// minutes. Below it there's nothing worth trimming; you just do it or skip (owner steer).
const TIMEFLEX_MIN_MINUTES = 10;

/**
 * Deterministically trim a walkthrough to ~targetMin: keep every core step, then add optional steps
 * in their original order while they still fit the budget. Core is the floor — never dropped. This
 * is step-level (drop whole exercises); set-level trimming (fewer sets) arrives with the sets/reps
 * work, which will let this hit a budget more finely.
 */
function fitToMinutes(wt: WalkthroughData, targetMin: number): WalkthroughData {
  const keep = new Set(wt.steps.filter((s) => s.core));
  let mins = [...keep].reduce((n, s) => n + s.minutes, 0);
  for (const s of wt.steps) {
    if (keep.has(s) || mins + s.minutes > targetMin) continue;
    keep.add(s);
    mins += s.minutes;
  }
  const steps = wt.steps.filter((s) => keep.has(s)); // original order
  return { ...wt, total_min: steps.reduce((n, s) => n + s.minutes, 0), steps };
}

const roundUp5 = (x: number) => Math.max(5, Math.ceil(x / 5) * 5);

/**
 * The redesign's task **start sheet** (REQ8 handoff §3) — the pre-flight popup a trail node opens.
 * It fetches the occurrence's coach session (generating it on first open, same as the old sheet),
 * projects it into a walkthrough, and shows the step summary + Start / "I have less time". Start
 * launches the full-screen `Walkthrough`; finishing marks the task done and refreshes the trail
 * (the node then shows its completed state). A task with no session (a system check-in) gets a
 * one-tap "mark it done" step. Food + weigh-in tasks keep their dedicated sheet — this is the
 * stepped-task popup.
 */
export function StartSheet({
  occurrenceId,
  title,
  onClose,
  onLogged,
}: {
  occurrenceId: string;
  title?: string; // the tapped node's title — lets the loader personalize before the detail lands
  onClose: () => void;
  onLogged?: () => void;
}) {
  const { detail, state } = useOccurrenceDetail(occurrenceId);
  const messages = useMemo(() => coachingMessages(title), [title]);
  const loadingMsg = useRotatingMessage(state === 'loading', messages);
  const [run, setRun] = useState<WalkthroughData | null>(null);
  const [timePick, setTimePick] = useState(false); // "I have less time" → the time-definition step
  const [showCustom, setShowCustom] = useState(false);
  const [customMin, setCustomMin] = useState('');

  const wt = useMemo<WalkthroughData | null>(() => {
    if (!detail) return null;
    if (detail.session) return deriveWalkthrough(detail.session);
    // No coach session (a system check-in) → a single "mark it done" step.
    return {
      total_min: detail.schedule?.duration_min ?? 5,
      steps: [
        {
          id: 's1',
          title: detail.title,
          minutes: detail.schedule?.duration_min ?? 5,
          tool: { kind: 'checkoff', label: 'Done' },
          skippable: false,
          core: true,
        },
      ],
    };
  }, [detail]);

  async function handleComplete(summary: string) {
    if (!detail) return;
    try {
      if (summary.trim()) await logOccurrence(detail.occurrence_id, summary);
      else await setOccurrence(detail.occurrence_id, 'done');
    } catch {
      /* best-effort — the plan refresh reflects reality */
    }
    onLogged?.();
    setRun(null);
    onClose();
  }

  const canFlex = !!wt && wt.steps.length > 2 && wt.total_min > TIMEFLEX_MIN_MINUTES;
  const total = wt?.total_min ?? 0;
  const t33 = roundUp5(total / 3);
  const t66 = roundUp5((total * 2) / 3);
  const runFit = (min: number) => wt && setRun(fitToMinutes(wt, min));

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="sheet ss" role="dialog" aria-label="Start task">
        <div className="sheet-grab" aria-hidden />
        {state === 'loading' ? (
          <div className="sheet-loading">
            <span className="typing">
              <i />
              <i />
              <i />
            </span>
            <span className="sheet-loading-t" key={loadingMsg}>
              {loadingMsg}
            </span>
          </div>
        ) : state === 'gone' ? (
          <div className="sheet-msg">This one moved with your new plan — close and take a fresh look at your week.</div>
        ) : state === 'error' || !detail || !wt ? (
          <div className="sheet-msg">{"Couldn't open this just now — close and tap it again in a moment."}</div>
        ) : detail.status !== 'pending' ? (
          <div className="sheet-msg">
            {"This one's already "}
            {detail.status === 'done' ? 'done — nice.' : `marked ${detail.status}.`}
          </div>
        ) : (
          <>
            <div className="ss-head">
              <div className="ss-disc" aria-hidden>
                ▶
              </div>
              <div className="ss-headt">
                <b>{detail.title}</b>
                <span>
                  {[detail.schedule?.time_of_day, `${wt.steps.length} STEPS`, `${wt.total_min} MIN`]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
            </div>

            <div className="ss-steps">
              {wt.steps.map((s) => (
                <div className="ss-step" key={s.id}>
                  <span className="ss-dot" aria-hidden />
                  <span className="ss-step-t">{s.title}</span>
                  <span className="ss-step-m">{s.minutes} min</span>
                </div>
              ))}
            </div>

            {!timePick ? (
              <>
                <button className="ss-btn ss-start" onClick={() => setRun(wt)}>
                  Start · {wt.total_min} min
                </button>
                {canFlex && (
                  <button className="ss-btn ss-less" onClick={() => setTimePick(true)}>
                    I have less time
                  </button>
                )}
              </>
            ) : (
              <div className="ss-timeask">
                <div className="ss-timeask-q">How much time do you have?</div>
                <div className="ss-chips">
                  <button className="ss-chip" onClick={() => runFit(t33)}>
                    ~{t33} min
                  </button>
                  <button className="ss-chip" onClick={() => runFit(t66)}>
                    ~{t66} min
                  </button>
                  <button className="ss-chip" onClick={() => setShowCustom((v) => !v)}>
                    Other…
                  </button>
                </div>
                {showCustom && (
                  <div className="ss-custom">
                    <input
                      className="ss-custom-in"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={total}
                      value={customMin}
                      onChange={(e) => setCustomMin(e.target.value)}
                      placeholder={`minutes (up to ${total})`}
                    />
                    <button
                      className="ss-chip"
                      disabled={!Number(customMin)}
                      onClick={() => runFit(Math.min(total, Math.max(1, Math.round(Number(customMin)))))}
                    >
                      Go
                    </button>
                  </div>
                )}
                <button className="ss-back" onClick={() => setTimePick(false)}>
                  ← back
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {run && detail && (
        <Walkthrough walkthrough={run} title={detail.title} onClose={() => setRun(null)} onComplete={handleComplete} />
      )}
    </>
  );
}
