import { useEffect, useRef, useState } from 'react';
import { getBuildRun, getPlan, lockPlan } from '../../lib/api.ts';
import { planRunProgress, type PlanRunStage } from '@cadence/shared';
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

/**
 * What the coach says she is doing, per STAGE. True statements only — each line is written
 * against what that stage's code actually does, so none of them can be showing while something
 * else is happening.
 */
export const STAGE_NOTES: Record<PlanRunStage, string> = {
  reading: 'Reading back everything you told me…',
  drafting: 'Working out each thing you want to do…',
  coordinating: 'Fitting it all into one week…',
  repairing: "Adding a few small anchors so the days aren't lopsided…",
  saving: 'Setting your week…',
};

/**
 * The drafting line when a goal has actually landed. Named rather than counted: the fan-out
 * knows which goal it just finished, and "worked out your running" is a fact about the person
 * where "2 of 3" is a fact about our architecture.
 */
export function draftedNote(drafted?: { done: number; total: number; title?: string }): string {
  if (!drafted?.title || drafted.done === 0) return STAGE_NOTES.drafting;
  const more = drafted.total - drafted.done;
  return more > 0
    ? `Worked out ${drafted.title.toLowerCase()} — ${more} to go…`
    : `Worked out ${drafted.title.toLowerCase()}…`;
}

/**
 * The API's own `maxDuration` (vercel.json). Past this the server has abandoned the build, so
 * there is genuinely nothing left to collect and giving up is honest.
 */
export const SERVER_BUILD_CEILING_MS = 800_000;

/**
 * How long to keep polling after a dropped connection before giving up.
 *
 * This has to outwait the SERVER, not a typical build: the deadline starts the moment the fetch
 * dies, which can be one second in, so any window shorter than the server's ceiling reports a
 * failure over a build that is still running and about to commit.
 *
 * At 5 minutes it did exactly that. A first plan measured 2026-09-05 took 6m30s end to end —
 * three per-goal drafts gated on the slowest at 179s, a 103s reduce, then a 107s density repair
 * (plan-density.ts, which fires only on a thin week, so a run has two quite different durations
 * depending on what the reduce produced). A phone backgrounded in the first ninety seconds of
 * that build got "Something went wrong on my end" over a week that committed fine.
 *
 * And that was the FAST case: across every synthesis on record the same phase spans 79s to 563s,
 * so a median first plan runs closer to ten minutes. Which is why this is pinned to the server's
 * ceiling rather than to any observed build — a window calibrated on a typical run would be a
 * coin flip, and the failure mode is telling someone their plan died while it is being written.
 * `useAppResume` still rescued it on the next foreground, so the cost was a lie rather than a
 * lost plan — but the obvious response to that lie is to tap retry and spend another six minutes.
 */
export const RECOVER_WINDOW_MS = SERVER_BUILD_CEILING_MS + 40_000;
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
  const [stage, setStage] = useState<PlanRunStage>('reading');
  const [drafted, setDrafted] = useState<{ done: number; total: number; title?: string }>();
  const [stageSince, setStageSince] = useState(() => Date.now());
  /**
   * Re-render while waiting, so the eased bar actually moves.
   *
   * Without this the bar only advances when a poll changes state — a step every five seconds,
   * which reads as a stalled screen rather than a working one. A second is the coarsest tick
   * that still looks continuous, and it stops the moment the run does.
   */
  const [, setTick] = useState(0);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  /**
   * Which attempt has already been started. Keyed by attempt number rather than a boolean, and
   * deliberately NOT paired with an `alive` flag that aborts on cleanup — StrictMode runs every
   * effect, cleans up, and re-runs on the same instance, and a boolean-plus-abort deadlocks that
   * exactly (see this file's tests). Start once per attempt, let it finish: the server has
   * claimed a durable run by the time cleanup could fire, and abandoning it half-done is worse.
   */
  const started = useRef(-1);
  /** Set the moment the plan is known committed, so two paths racing to finish (the poll and
   *  the resume check) can only call `onDone` once. */
  const finished = useRef(false);
  /** The stage last seen, so the easing clock restarts only on a REAL transition. */
  const lastStage = useRef<PlanRunStage | null>(null);

  function settle() {
    if (finished.current) return;
    finished.current = true;
    setPhase('done');
    onDone();
  }

  /** Fold one poll answer into what the screen shows. Returns true when the run is over. */
  function apply(r: Awaited<ReturnType<typeof getBuildRun>>): boolean {
    if (!r.ok) return false; // an unknown is not an answer — keep polling
    if (r.committed) {
      settle();
      return true;
    }
    if (r.failed) {
      setError(r.failed.message);
      setPhase('failed');
      return true;
    }
    if (r.running) {
      if (lastStage.current !== r.running.stage) {
        lastStage.current = r.running.stage;
        setStage(r.running.stage);
        setStageSince(Date.now());
      }
      setDrafted(r.running.drafted);
    }
    return false;
  }

  /**
   * Coming back is itself evidence worth acting on. Someone who left during a build has almost
   * certainly returned to a finished week — the run completes server-side regardless — and the
   * poll below may be mid-sleep when they arrive. One cheap read on resume is the difference
   * between "here's your week" and a spinner over a plan that has been ready for ten minutes.
   */
  useAppResume(() => {
    if (finished.current || !run) return;
    void getBuildRun()
      .then(apply)
      .catch(() => {
        /* offline on resume — the poll loop and the next resume both still cover this */
      });
  });

  useEffect(() => {
    if (!run || phase === 'done' || phase === 'failed') return;
    const t = setInterval(() => setTick((n) => n + 1), 1_000);
    return () => clearInterval(t);
  }, [run, phase]);

  useEffect(() => {
    if (!run || started.current === attempt) return;
    started.current = attempt;
    (async () => {
      try {
        setPhase('building');
        const { status, body } = await lockPlan();
        // 202 is the normal answer now: the run is CLAIMED, not finished. A refusal still comes
        // back synchronously, because the guardrail gate runs before any model call.
        if (status === 409 || (body as { status?: string }).status === 'needs_focus') {
          setError("That's a lot to carry at once — want to pick the few that matter most right now?");
          setPhase('failed');
          return;
        }
        if (status >= 400) {
          if (await recoverIfAlreadyCommitted(onDone)) return;
          setError(
            (body.violations as string[] | undefined)?.join('; ') || "I couldn't set it yet — give me another go?",
          );
          setPhase('failed');
          return;
        }
      } catch {
        // The POST itself died. It may still have claimed the run, so this is UNKNOWN rather
        // than failure — fall through to the poll, which is the only thing that can tell us.
        setPhase('checking');
      }

      // Watch the durable record. This is the ordinary path now, not a recovery path: the build
      // never lived in a request to begin with.
      const deadline = Date.now() + recoverWindowMs;
      while (Date.now() < deadline && !finished.current) {
        try {
          if (apply(await getBuildRun())) return;
        } catch {
          /* offline blip — keep polling */
        }
        await new Promise((r) => setTimeout(r, recoverEveryMs));
      }
      if (finished.current) return;
      setError('Something went wrong on my end — give me another go?');
      setPhase('failed');
    })();
    // `attempt` is the retry trigger; onDone is stable enough for this one-shot sequence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, attempt]);

  return {
    phase,
    error,
    stage,
    drafted,
    /** Where the bar sits. Never 1 — only a committed plan finishes it. */
    progress: phase === 'done' ? 1 : planRunProgress(stage, drafted, Date.now() - stageSince),
    stageSince,
    note:
      phase === 'done' || phase === 'failed' ? '' : stage === 'drafting' ? draftedNote(drafted) : STAGE_NOTES[stage],
    retry: () => {
      setError('');
      lastStage.current = null;
      setStage('reading');
      setDrafted(undefined);
      setStageSince(Date.now());
      setAttempt((a) => a + 1);
    },
  };
}
