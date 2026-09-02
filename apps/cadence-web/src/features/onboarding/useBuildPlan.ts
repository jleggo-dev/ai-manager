import { useEffect, useRef, useState } from 'react';
import { getPlan, lockPlan } from '../../lib/api.ts';
import { useAppResume } from '../../lib/useAppResume.ts';

/**
 * If a lock already succeeded server-side but the client never advanced (e.g. the response was
 * lost to a connection blip), route to the plan instead of dead-ending on a confusing error.
 */
export async function recoverIfAlreadyCommitted(onLocked: () => void): Promise<boolean> {
  try {
    if ((await getPlan())?.stage === 'committed') {
      onLocked();
      return true;
    }
  } catch {
    /* fall through to the normal error path */
  }
  return false;
}

/**
 * Build the first week, once the user has said "build it".
 *
 * ONE server call now, not three. It was confirmGoals → previewPlan → lockPlan, which made the
 * CLIENT the orchestrator of a minutes-long pipeline — and a phone is the one place that cannot
 * hold that job: the moment someone switches apps to wait somewhere nicer, iOS suspends the
 * webview and the in-flight fetch dies between steps. `lockPlan` is server-side self-sufficient
 * (previewLock confirms captured goals and synthesizes when nothing is pending) and commits
 * before it answers, so a build the client stops listening to still lands. Fire the one call,
 * and if it dies on OUR side, poll for the committed plan instead of declaring failure.
 *
 * Three ways back in, because each covers a gap the others don't: the fetch resolving, the poll
 * behind a REJECTED fetch, and `useAppResume` — the one that matters on a real phone, since a
 * fetch killed by iOS suspension may never reject at all, and until this hook existed nothing
 * looked for the finished week when you came back to it. (The push notification is the nudge on
 * top; PLAN.md.)
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
  /** Set the moment the plan is known committed, so two paths racing to finish (the fetch and
   *  the resume check) can only call `onDone` once. */
  const finished = useRef(false);

  function settle() {
    if (finished.current) return;
    finished.current = true;
    setPhase('done');
    onDone();
  }

  /**
   * Coming back is itself evidence worth acting on. Someone who left during a build has almost
   * certainly returned to a finished week — the build runs to completion server-side — but the
   * only thing that used to look for it was the poll behind a REJECTED fetch, and a fetch killed
   * by iOS suspension may never reject. So check the plan directly on resume: it is one cheap
   * request, and it is the difference between "here's your week" and a spinner over a plan that
   * has been ready for ten minutes.
   */
  useAppResume(() => {
    if (finished.current || !run) return;
    void getPlan()
      .then((p) => {
        if (p?.stage === 'committed') settle();
      })
      .catch(() => {
        /* offline on resume — the poll loop and the next resume both still cover this */
      });
  });

  useEffect(() => {
    if (!run || started.current === attempt) return;
    started.current = attempt;
    (async () => {
      try {
        setPhase('building');
        const { status, body } = await lockPlan();
        if (status === 200) {
          settle();
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
        while (Date.now() < deadline && !finished.current) {
          try {
            if ((await getPlan())?.stage === 'committed') {
              settle();
              return;
            }
          } catch {
            /* offline blip — keep polling */
          }
          await new Promise((r) => setTimeout(r, recoverEveryMs));
        }
        if (finished.current) return;
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
