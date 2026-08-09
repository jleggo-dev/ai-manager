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
  /**
   * Which attempt has already been started. Keyed by attempt number rather than a boolean, and
   * deliberately NOT paired with an `alive` flag that aborts on cleanup.
   *
   * StrictMode runs every effect, cleans it up, and runs it again on the same instance. A boolean
   * guard plus cleanup-aborts deadlocks that pattern exactly: the first run claims the guard and
   * then aborts itself on cleanup, the second run sees the guard still held and skips — and the
   * build screen spins forever. (It did. That is what this file's tests are for.)
   *
   * So: start once per attempt, and let it finish. The sequence is three server calls that have
   * already committed real state by the time cleanup could fire; abandoning it half-done is worse
   * than completing it, and `lockPlan` is the only irreversible one — which the key protects.
   */
  const started = useRef(-1);

  useEffect(() => {
    if (!run || started.current === attempt) return;
    started.current = attempt;
    (async () => {
      try {
        setPhase('confirming');
        await confirmGoals();
        setPhase('placing');
        const preview = await previewPlan();
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
