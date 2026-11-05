import { useEffect } from 'react';
import { capabilities } from '../../../lib/capability/index.ts';

/**
 * The screen stays on while `running` is true, and only then — held on the way in, let go on the
 * way out and on unmount. Extracted from the metronome (owner, 2026-11-01: the screen stays on
 * while it clicks), which still uses it; the running clock's hold goes through it too, from the
 * app root (useClockKeepAwake.ts), because the clock outlives the tool that started it. The
 * capability counts its holders, so the two never drop each other's hold.
 */
export function useKeepAwakeWhile(running: boolean): void {
  useEffect(() => {
    if (!running) return undefined;
    void capabilities.keepAwake.set(true);
    return () => void capabilities.keepAwake.set(false);
  }, [running]);
}
