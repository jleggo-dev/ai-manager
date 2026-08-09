import { useEffect, useRef, useState } from 'react';
import { confirmGoals, lockPlan, previewPlan } from '../../lib/api.ts';
import { recoverIfAlreadyCommitted } from '../review/useReviewWizard.ts';

/**
 * Build the first week, once the user has said "build it".
 *
 * The old wizard split this in two — see the plan, then commit it. That second confirmation made
 * sense when the last thing the user had confirmed was a form; it does not when they have just
 * read back everything the coach heard and said yes. So the confirmation moves earlier (the
 * `confirm` turn in chat) and this runs the whole sequence, with the built week shown afterwards.
 *
 * The phases are named because they are what the status line says out loud. They are the real
 * calls in order, not a fake progress bar — a wait that lies about what it is doing teaches
 * people to distrust every wait after it.
 */
export type BuildPhase = 'confirming' | 'placing' | 'setting' | 'done' | 'failed';

/** What the coach says she is doing, per phase. True statements only. */
export const BUILD_NOTES: Record<Exclude<BuildPhase, 'done' | 'failed'>, string> = {
  confirming: 'Writing down everything you told me…',
  placing: 'Placing your week around what you work around…',
  setting: 'Setting your rhythm…',
};

export function useBuildPlan({ onDone, run = true }: { onDone: () => void; run?: boolean }) {
  const [phase, setPhase] = useState<BuildPhase>('confirming');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  // StrictMode double-invokes effects; a second lockPlan on the same plan is not something to
  // find out about in production.
  const running = useRef(false);

  useEffect(() => {
    if (!run || running.current) return;
    running.current = true;
    let alive = true;
    (async () => {
      try {
        setPhase('confirming');
        await confirmGoals();
        if (!alive) return;
        setPhase('placing');
        const preview = await previewPlan();
        if (!alive) return;
        if (preview.status === 'needs_focus') {
          setError("That's a lot to carry at once — want to pick the few that matter most right now?");
          setPhase('failed');
          return;
        }
        if (preview.status !== 'proposed') {
          if (await recoverIfAlreadyCommitted(onDone)) return;
          setError(preview.violations?.join('; ') || "I couldn't put it together yet — give me another go?");
          setPhase('failed');
          return;
        }
        setPhase('setting');
        const { status, body } = await lockPlan();
        if (!alive) return;
        if (status === 200) {
          setPhase('done');
          onDone();
          return;
        }
        if (await recoverIfAlreadyCommitted(onDone)) return;
        setError(
          (body.violations as string[] | undefined)?.join('; ') || "I couldn't set it yet — give me another go?",
        );
        setPhase('failed');
      } catch {
        if (!alive) return;
        setError('Something went wrong on my end — give me another go?');
        setPhase('failed');
      } finally {
        running.current = false;
      }
    })();
    return () => {
      alive = false;
    };
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
