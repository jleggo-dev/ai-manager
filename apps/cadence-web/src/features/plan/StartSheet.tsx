import { useMemo, useState } from 'react';
import { deriveWalkthrough, condense, type Walkthrough as WalkthroughData } from '@cadence/shared';
import { useOccurrenceDetail } from './occurrence/useOccurrenceDetail.ts';
import { Walkthrough } from '../walkthrough/Walkthrough.tsx';
import { setOccurrence, logOccurrence } from '../../lib/api.ts';

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
  onClose,
  onLogged,
}: {
  occurrenceId: string;
  onClose: () => void;
  onLogged?: () => void;
}) {
  const { detail, state } = useOccurrenceDetail(occurrenceId);
  const [run, setRun] = useState<WalkthroughData | null>(null);

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

  const shortWt = wt && wt.steps.length > 2 ? condense(wt) : null;

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
            <span className="sheet-loading-t">Lining up your steps…</span>
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

            <button className="ss-btn ss-start" onClick={() => setRun(wt)}>
              Start · {wt.total_min} min
            </button>
            {shortWt && (
              <button className="ss-btn ss-less" onClick={() => setRun(shortWt)}>
                I have less time · {shortWt.total_min} min
              </button>
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
