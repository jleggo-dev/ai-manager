import { useEffect, useMemo, useState } from 'react';
import { deriveWalkthrough, type Walkthrough as WalkthroughData } from '@cadence/shared';
import { useOccurrenceDetail } from './occurrence/useOccurrenceDetail.ts';
import { CoachPlainVersion, CoachUnreachable } from './occurrence/CoachUnreachable.tsx';
import { WatchHandoffRow } from './occurrence/WatchHandoffRow.tsx';
import { coachingMessages, useRotatingMessage } from './coaching-progress.ts';
import { StartCoachAsk } from './start/StartCoachAsk.tsx';
import { StartTrim } from './start/StartTrim.tsx';
import { applyTrim, canTrim, proposeTrim, type TrimProposal } from './start/trim.ts';
import { Walkthrough } from '../walkthrough/Walkthrough.tsx';
import { clearSessionInProgress, type SessionSnapshot } from '../walkthrough/sessionInProgress.ts';
import { CoachFace } from '../../components/CoachFace.tsx';
import { getSessionInsight, setOccurrence, logOccurrence, type SessionInsight } from '../../lib/api.ts';

/**
 * The redesign's task **start sheet** (REQ8 handoff §3) — the pre-flight popup a trail node opens,
 * and the surface where Cadence asks the one question worth asking before you begin.
 *
 * It fetches the occurrence's coach session (generating it on first open, same as the old sheet),
 * projects it into a walkthrough, and shows Cadence's ask + at most one insight + the step summary
 * + three doors:
 *
 *   Start           — run it as planned.
 *   I have less time — Cadence PROPOSES which steps to cut and the user confirms. It deliberately
 *                     never asks for a number; see start/trim.ts for why that inversion matters.
 *   Custom          — hand the whole thing to the coach in the user's own words ("I'd rather do a
 *                     10-min walking meditation, I'm by the beach"), which can move it, swap it, or
 *                     design a replacement. Routes through the ordinary suggest→preview→confirm
 *                     adjust flow, so a session can't be rewritten without being shown first.
 *
 * The insight is fetched in PARALLEL with the detail rather than bundled into it: the detail call
 * can spend seconds generating a session, and the insight is two indexed reads — bundling them
 * would hold a ready card behind an unready one.
 *
 * A task with no session (a system check-in) gets a one-tap "mark it done" step. Food + weigh-in
 * tasks keep their dedicated sheet — this is the stepped-task popup.
 *
 * `resume` is a session the app was in the middle of when iOS reclaimed it (sessionInProgress.ts):
 * the walkthrough opens straight away from what was remembered, without waiting on the detail —
 * the person was mid-practice, not choosing how to start.
 */
export function StartSheet({
  occurrenceId,
  title,
  onClose,
  onLogged,
  onCustom,
  onTalk,
  resume,
}: {
  occurrenceId: string;
  title?: string; // the tapped node's title — lets the loader personalize before the detail lands
  onClose: () => void;
  onLogged?: () => void;
  /** "Custom — let's talk": opens the adjust flow seeded with this activity. */
  onCustom?: (steer: string) => void;
  /** Opens the coach from the post-session celebration. */
  onTalk?: () => void;
  resume?: SessionSnapshot | null;
}) {
  const { detail, state, retry } = useOccurrenceDetail(occurrenceId);
  const messages = useMemo(() => coachingMessages(title), [title]);
  const loadingMsg = useRotatingMessage(state === 'loading', messages);
  const [run, setRun] = useState<WalkthroughData | null>(resume?.walkthrough ?? null);
  // Used once: a later Start from this same sheet is a fresh run, not the remembered one.
  const [resumeFrom, setResumeFrom] = useState(resume ?? null);
  const [trimLevel, setTrimLevel] = useState<number | null>(null); // null → not trimming
  const [insight, setInsight] = useState<SessionInsight | null>(null);

  useEffect(() => {
    let alive = true;
    void getSessionInsight(occurrenceId).then((i) => alive && setInsight(i));
    return () => {
      alive = false;
    };
  }, [occurrenceId]);

  // The remembered session belongs to a task that has since moved on — replanned away, or logged
  // somewhere else (the watch) — so there is nothing to go back to.
  useEffect(() => {
    if (!resumeFrom || !(state === 'gone' || (detail && detail.status !== 'pending'))) return;
    clearSessionInProgress();
    setResumeFrom(null);
    setRun(null);
  }, [resumeFrom, state, detail]);

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

  /**
   * Done closes the sheet NOW. The write behind it — a model parse of the summary into a
   * structured log — takes ten to fifteen seconds, and waiting on it left "Done" apparently dead
   * on a finished ruck (2026-09-06). The celebration already happened; nothing on this screen
   * depends on the server's answer. The plan refresh runs when the write lands (or fails — the
   * refresh then shows reality), so the trail catches up on its own.
   */
  function handleComplete(summary: string) {
    // The prop, not the detail: a resumed session can finish before the detail has landed.
    const write = summary.trim() ? logOccurrence(occurrenceId, summary) : setOccurrence(occurrenceId, 'done');
    void write.catch(() => undefined).then(() => onLogged?.());
    setResumeFrom(null);
    setRun(null);
    onClose();
  }

  const proposal: TrimProposal | null = wt && trimLevel !== null ? proposeTrim(wt, trimLevel) : null;

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
        ) : state === 'unreachable' ? (
          <CoachUnreachable onRetry={retry} />
        ) : state === 'error' || !detail || !wt ? (
          <div className="sheet-msg">{"Couldn't open this just now — close and tap it again in a moment."}</div>
        ) : detail.status !== 'pending' ? (
          <div className="sheet-msg">
            {"This one's already "}
            {detail.status === 'done' ? 'done — nice.' : `marked ${detail.status}.`}
          </div>
        ) : proposal ? (
          <StartTrim
            proposal={proposal}
            onConfirm={() => setRun(applyTrim(wt, proposal))}
            onTrimMore={() => setTrimLevel((l) => (l ?? 0) + 1)}
            onBack={() => setTrimLevel(null)}
          />
        ) : (
          <>
            {detail.session?.fallback === 'coach_unreachable' && <CoachPlainVersion onRetry={retry} />}
            <StartCoachAsk
              title={detail.title}
              timeOfDay={detail.schedule?.time_of_day}
              minutes={wt.total_min}
              insight={insight}
            />

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
              {"I've got time"} · {wt.total_min} min
            </button>
            {canTrim(wt) && (
              <button className="ss-btn ss-less" onClick={() => setTrimLevel(0)}>
                I have less time
                <span>{"we'll pick what to trim together"}</span>
              </button>
            )}
            {onCustom && (
              <button
                className="ss-btn ss-talk"
                onClick={() => onCustom(`About today's ${detail.title}: `)}
                aria-label="Custom — let's talk"
              >
                <CoachFace size={28} />
                <span>{"Custom — let's talk"}</span>
              </button>
            )}
            {/* A13: "send this to your watch", under the ways to start. Renders nothing unless the
                whole native chain says yes (paired watch, WorkoutKit, authorization — see
                useWatchHandoff), so on web and watchless phones this line does not exist. */}
            <WatchHandoffRow
              occurrenceId={detail.occurrence_id}
              title={detail.title}
              dateISO={detail.date}
              session={detail.session}
              pending={detail.status === 'pending'}
            />
          </>
        )}
      </div>

      {run && (detail || resumeFrom) && (
        <Walkthrough
          walkthrough={run}
          title={detail?.title ?? resumeFrom?.title ?? title ?? ''}
          occurrenceId={occurrenceId}
          area={detail?.area ?? resumeFrom?.area}
          resume={resumeFrom}
          onClose={() => {
            setResumeFrom(null);
            setRun(null);
          }}
          onComplete={handleComplete}
          onTalk={onTalk}
        />
      )}
    </>
  );
}
