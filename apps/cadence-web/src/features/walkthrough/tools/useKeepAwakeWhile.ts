import { useEffect } from 'react';
import { capabilities } from '../../../lib/capability/index.ts';

/**
 * The screen stays on while `running` is true, and only then.
 *
 * Extracted from the metronome (owner, 2026-11-01: the screen stays on while it clicks) for every
 * clock the person watches — the timer, timed sets, the interval player, a circuit move's clock
 * (walkthrough v3 R6, 2026-11-03). A phone that auto-locks on the gym floor silences the chime and
 * hides the clock; the opposite failure — a screen left held after the clock stopped or the step
 * closed — drains a battery in a pocket and nothing ever says so. So the hold is released on every
 * way out: pause, stop, finish, and the tool unmounting.
 *
 * A sit and the breath pacer pass the per-device setting in (lib/sit-screen.ts): keep-awake means
 * a lit screen, and a person sitting with their eyes closed did not ask for a lamp.
 */
export function useKeepAwakeWhile(running: boolean): void {
  useEffect(() => {
    if (!running) return undefined;
    void capabilities.keepAwake.set(true);
    return () => void capabilities.keepAwake.set(false);
  }, [running]);
}
