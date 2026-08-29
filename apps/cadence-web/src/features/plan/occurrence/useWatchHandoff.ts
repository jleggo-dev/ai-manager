import { useEffect, useMemo, useState } from 'react';
import { composeWorkoutPlan, type OccurrenceSession } from '@cadence/shared';
import { capabilities } from '../../../lib/capability/index.ts';

/**
 * "Send this to your watch" — state machine for the A13 hand-off, kept out of the sheet so the
 * sheet stays a dispatcher.
 *
 * `visible` is the load-bearing answer and it defaults to NO. The affordance renders only when
 * every layer said yes: native platform, WorkoutKit present, a paired watch, authorization not
 * refused, and a session that actually composes to something a watch can run. A dead "send to
 * your watch" button is exactly the class of defect the device rounds keep finding (A5/A6/A13),
 * so any failure anywhere collapses to "render nothing" — the session sheet is complete without
 * this row, which is what makes nothing the safe answer.
 */
export type WatchHandoffPhase =
  | 'idle' // visible, not yet sent
  | 'sending'
  | 'sent' // on the watch (this open, or found there via listScheduled)
  | 'failed';

export function useWatchHandoff(input: {
  occurrenceId: string;
  title: string;
  dateISO: string;
  session: OccurrenceSession | null | undefined;
  /** The sheet only offers the hand-off for a session still ahead of you. */
  pending: boolean;
}) {
  const { occurrenceId, title, dateISO, session, pending } = input;
  const spec = useMemo(
    () => (pending ? composeWorkoutPlan(occurrenceId, title, session) : null),
    [occurrenceId, title, session, pending],
  );

  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<WatchHandoffPhase>('idle');

  useEffect(() => {
    let cancelled = false;
    setVisible(false);
    setPhase('idle');
    if (!spec || !capabilities.workoutPlan.isAvailable()) return;
    void (async () => {
      const { supported, state } = await capabilities.workoutPlan.isSupported();
      // denied/restricted: the user answered; re-offering every open would be nagging. The one
      // path back is iOS Settings, and a control we cannot honour is worse than none.
      if (cancelled || !supported || state === 'denied' || state === 'restricted') return;
      const scheduled = await capabilities.workoutPlan.listScheduled();
      if (cancelled) return;
      if (scheduled.some((s) => s.id === spec.id && !s.complete)) setPhase('sent');
      setVisible(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [spec]);

  async function send() {
    if (!spec || phase === 'sending') return;
    setPhase('sending');
    const auth = await capabilities.workoutPlan.requestAuthorization();
    if (auth !== 'authorized') {
      // They said no just now — that is an answer, not an error. The row goes away.
      setVisible(false);
      return;
    }
    const results = await capabilities.workoutPlan.schedule([{ spec, dateISO }]);
    setPhase(results.some((r) => r.id === spec.id && r.scheduled) ? 'sent' : 'failed');
  }

  async function remove() {
    if (!spec) return;
    await capabilities.workoutPlan.remove(spec.id);
    setPhase('idle');
  }

  return { visible, phase, send, remove };
}
