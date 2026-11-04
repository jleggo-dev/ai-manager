import { useEffect, useRef, useState } from 'react';
import { TONE, RING_C } from './tone.ts';
import { unlockAudio } from './chime.ts';
import { useWallClock } from './useWallClock.ts';
import { useHandoff } from './useHandoff.ts';
import { formatClock } from './timer.ts';
import { logBtn as amberBtn } from './timerStyles.ts';
import { useKeepAwakeWhile } from './useKeepAwakeWhile.ts';
import { useRegisteredClock } from '../useRegisteredClock.ts';
import { getRunningClock, unregisterClock } from '../runningClock.ts';

/**
 * The countdown for one timed move inside a circuit — a 30 s plank between two reps moves.
 *
 * Until 2026-11-03 a timed circuit move read "30s hold — self-timed" and showed no clock at all
 * (owner's gym session). This is StepTimer's clock, cut down to what a move inside a rotation
 * needs: the same wall-clock seconds (`useWallClock`, so leaving the app loses nothing), the same
 * chime at zero — played by the app-level clock store (runningClock.ts), so it sounds on any
 * screen — the audio opened inside the Start tap so that chime is allowed to sound, the screen
 * held while it runs, and at zero the same hand-off beat before the circuit moves to the next
 * move — by the path the Log move button takes, so the round's log is the same shape either way.
 *
 * What it leaves out on purpose: no pre-roll (you just logged the previous move, you are in
 * position), no +1 min, no pocket alarm, no lock-screen clock. Interim look; design round B
 * restyles it. The Log move button under it still logs the move early at any time.
 *
 * Mount it with a `key` per move: a fresh clock per move is simpler than resetting one — unless
 * the store already holds this move's clock (the circuit was left mid-plank and come back to), in
 * which case it opens running from that mark, caught up.
 */
export function CircuitMoveClock({
  seconds,
  stepId = 'step',
  title = 'Move',
  onElapsed,
}: {
  seconds: number;
  /** The step and the move's name, for the app-level clock store and its pill. */
  stepId?: string;
  title?: string;
  onElapsed: () => void;
}) {
  const target = Math.max(1, Math.round(seconds));
  const [resume] = useState(() => {
    const c = getRunningClock();
    return c && c.kind === 'circuit_move' && c.stepId === stepId && c.title === title ? c : null;
  });
  const [base, setBase] = useState(resume?.base ?? 0);
  const [startedAt, setStartedAt] = useState<number | null>(resume?.startedAt ?? null);
  const elapsed = useWallClock(startedAt, base);
  const finished = useRef(false);
  const handoff = useHandoff();
  const onElapsedRef = useRef(onElapsed);
  onElapsedRef.current = onElapsed;
  const running = startedAt != null;
  const remaining = Math.max(0, target - elapsed);

  useRegisteredClock(
    startedAt != null ? { stepId, title, kind: 'circuit_move', startedAt, base, targetSec: target, chime: true } : null,
  );
  useKeepAwakeWhile(running);

  function startOrPause() {
    unlockAudio(); // inside the tap, so the chime at zero — with no finger near the phone — may sound
    if (finished.current) return;
    if (running) {
      setBase(elapsed);
      setStartedAt(null);
      unregisterClock(stepId);
    } else {
      setStartedAt(Date.now());
    }
  }

  useEffect(() => {
    if (!running || elapsed < target || finished.current) return;
    finished.current = true;
    setBase(target);
    setStartedAt(null);
    unregisterClock(stepId);
    // Not `return () => clearTimeout(...)` — see useHandoff for why that cancels itself.
    handoff.schedule(() => onElapsedRef.current(), 600);
  }, [running, elapsed, target, handoff, stepId]);

  const done = finished.current;
  const frac = Math.min(1, elapsed / target);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <div
        style={{
          position: 'relative',
          width: 120,
          height: 120,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="120" height="120" viewBox="0 0 128 128" style={{ position: 'absolute' }} aria-hidden>
          <circle cx="64" cy="64" r="54" fill="none" strokeWidth={13} stroke={TONE.track} />
          {frac > 0 && (
            <circle
              cx="64"
              cy="64"
              r="54"
              fill="none"
              strokeWidth={13}
              strokeLinecap="round"
              stroke={done ? TONE.deep : TONE.fillA}
              strokeDasharray={`${RING_C * frac} ${RING_C}`}
              transform="rotate(-90 64 64)"
              style={{ transition: 'stroke-dasharray 1s linear' }}
            />
          )}
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <div
            style={{
              fontFamily: 'var(--display), serif',
              fontWeight: 600,
              fontSize: 34,
              lineHeight: 1,
              color: TONE.ink,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatClock(remaining)}
          </div>
          <div
            style={{
              fontSize: 9.5,
              fontWeight: 900,
              letterSpacing: '0.09em',
              textTransform: 'uppercase',
              color: TONE.sub,
            }}
          >
            {done ? 'done' : `of ${formatClock(target)}`}
          </div>
        </div>
      </div>

      {/* Starting and pausing are in progress, so the face is amber; the green Log move button below
          is the one that writes. */}
      <button
        style={{ ...amberBtn, alignSelf: 'stretch', padding: 12, ...(done ? { opacity: 0.62 } : null) }}
        onClick={startOrPause}
        disabled={done}
      >
        {done ? 'Time ✓' : running ? 'Pause' : base > 0 ? 'Resume' : `Start · ${formatClock(target)}`}
      </button>
    </div>
  );
}
