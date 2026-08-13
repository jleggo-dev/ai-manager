import { useEffect, useRef, useState } from 'react';
import { getPlan, lockPlan } from '../../lib/api.ts';
import { recoverIfAlreadyCommitted } from '../review/useReviewWizard.ts';

/**
 * Build the first week, once the user has said "build it".
 *
 * ONE server call now, not three. It was confirmGoals → previewPlan → lockPlan, which made the
 * CLIENT the orchestrator of a minutes-long pipeline — and a phone is the one place that cannot
 * hold that job: the moment someone switches apps to wait somewhere nicer, iOS suspends the
 * webview and the in-flight fetch dies between steps. `lockPlan` is server-side self-sufficient
 * (previewLock confirms captured goals and synthesizes when nothing is pending), and the
 * serverless invocation runs to completion whether or not the client is still listening. So:
 * fire the one call, and if it dies on OUR side, assume the server may still be working and
 * POLL for the committed plan instead of declaring failure — leaving the app mid-build is now
 * safe, and coming back finds the finished week. (The push notification for "it's ready" is the
 * follow-up on top of this; PLAN.md.)
 */
export type BuildPhase = 'building' | 'checking' | 'done' | 'failed';

/** What the coach says she is doing, per phase. True statements only. */
export const BUILD_NOTES: Record<Exclude<BuildPhase, 'done' | 'failed'>, string> = {
  building: 'Writing down everything you told me and building your week…',
  checking: 'Checking how far I got…',
};

/** How long to keep polling after a dropped connection before giving up (the server-side build
 *  itself runs minutes; a return-from-background poll has to outwait the remainder). */
const RECOVER_WINDOW_MS = 5 * 60_000;
const RECOVER_EVERY_MS = 5_000;

export function useBuildPlan({
  onDone,
  run = true,
  recoverEveryMs = RECOVER_EVERY_MS,
  recoverWindowMs = RECOVER_WINDOW_MS,
}: {
  onDone: () => void;
  run?: boolean;
  /** Test seams — real timings make the poll path untestable. */
  recoverEveryMs?: number;
  recoverWindowMs?: number;
}) {
  const [phase, setPhase] = useState<BuildPhase>('building');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  /**
   * Which attempt has already been started. Keyed by attempt number rather than a boolean, and
   * deliberately NOT paired with an `alive` flag that aborts on cleanup — StrictMode runs every
   * effect, cleans up, and re-runs on the same instance, and a boolean-plus-abort deadlocks that
   * exactly (see this file's tests). Start once per attempt, let it finish: the server has
   * committed real state by the time cleanup could fire, and abandoning it half-done is worse.
   */
  const started = useRef(-1);

  useEffect(() => {
    if (!run || started.current === attempt) return;
    started.current = attempt;
    (async () => {
      try {
        setPhase('building');
        const { status, body } = await lockPlan();
        if (status === 200) {
          setPhase('done');
          onDone();
          return;
        }
        if (await recoverIfAlreadyCommitted(onDone)) return;
        if ((body as { status?: string }).status === 'needs_focus') {
          setError("That's a lot to carry at once — want to pick the few that matter most right now?");
          setPhase('failed');
          return;
        }
        setError(
          (body.violations as string[] | undefined)?.join('; ') || "I couldn't set it yet — give me another go?",
        );
        setPhase('failed');
      } catch {
        // The FETCH died — which, on a phone, usually means the app was backgrounded while the
        // server kept building. Poll for the committed plan before believing anything failed.
        setPhase('checking');
        const deadline = Date.now() + recoverWindowMs;
        while (Date.now() < deadline) {
          try {
            if ((await getPlan()).stage === 'committed') {
              setPhase('done');
              onDone();
              return;
            }
          } catch {
            /* offline blip — keep polling */
          }
          await new Promise((r) => setTimeout(r, recoverEveryMs));
        }
        setError('Something went wrong on my end — give me another go?');
        setPhase('failed');
      }
    })();
    // `attempt` is the retry trigger; onDone is stable enough for this one-shot sequence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, attempt]);

  return {
    phase,
    error,
    note: phase === 'done' || phase === 'failed' ? '' : BUILD_NOTES[phase],
    retry: () => {
      setError('');
      setAttempt((a) => a + 1);
    },
  };
}
