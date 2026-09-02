import { useEffect, useState } from 'react';
import { SESSION_PREP_STEPS, readProgressLine } from '@cadence/shared';

/**
 * The line under the dots while a session is being written.
 *
 * PERF-08: a first open takes ~34s because the coach genuinely prescribes the session. The sheet
 * showed ONE static line for all of it — true, and after ten seconds indistinguishable from a hang.
 * The dots were already honest; what was missing was any sign of progress within them.
 *
 * Same shape as the photo read (owner's ruling, 2026-08-21): narrate the wait, specifically. The
 * clock lives here and the copy is pure, so the phrasing stays testable without timers.
 *
 * `active` rather than an unconditional interval: the sheet unmounts this on every other state, and
 * a ticker left running behind a closed sheet is a leak with a status message attached.
 */
export function useSessionPrepLine(active: boolean): string {
  const [line, setLine] = useState('');

  useEffect(() => {
    if (!active) {
      setLine('');
      return;
    }
    const startedAt = Date.now();
    const tick = () => setLine(readProgressLine(SESSION_PREP_STEPS, Date.now() - startedAt));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [active]);

  return line;
}
