import type { CSSProperties } from 'react';
import { useStepTimer } from './useStepTimer.ts';
import { elapsedFraction, formatClock } from './timer.ts';
import { playChime } from './chime.ts';

/**
 * The timer tool's renderer (REQ8) — a big m:ss clock over an elapsed bar, with Start/Pause and
 * Reset. On completion it chimes (when `chime`) and calls `onComplete`, so the walkthrough can mark
 * the step done and advance. Self-contained inline styles for now: the walkthrough's own stylesheet
 * lands with the walkthrough shell (REQ8 §7 slice 3), and this drops straight into it then.
 */
export function StepTimer({
  seconds,
  chime = true,
  onComplete,
}: {
  seconds: number;
  chime?: boolean;
  onComplete?: () => void;
}) {
  const { state, start, pause, reset } = useStepTimer(seconds, () => {
    if (chime) playChime();
    onComplete?.();
  });
  const pct = Math.round(elapsedFraction(state) * 100);
  const done = state.status === 'done';

  return (
    <div className="step-timer" style={wrap}>
      <div aria-live="polite" style={clock}>
        {formatClock(state.remaining)}
      </div>
      <div style={track}>
        <div style={{ ...fill, width: `${pct}%` }} />
      </div>
      <div style={row}>
        {done ? (
          <button style={btn} onClick={reset}>
            Again
          </button>
        ) : state.status === 'running' ? (
          <button style={btn} onClick={pause}>
            Pause
          </button>
        ) : (
          <button style={btn} onClick={start}>
            {state.status === 'paused' ? 'Resume' : 'Start'}
          </button>
        )}
        {!done && state.status !== 'ready' && (
          <button style={{ ...btn, ...btnGhost }} onClick={reset}>
            Reset
          </button>
        )}
      </div>
      {done && <div className="prog-sub">Done — nice.</div>}
    </div>
  );
}

const wrap: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 };
const clock: CSSProperties = {
  fontSize: 56,
  fontWeight: 800,
  fontVariantNumeric: 'tabular-nums',
  letterSpacing: '0.02em',
  color: 'var(--forest, #3f7a52)',
};
const track: CSSProperties = {
  width: '100%',
  height: 6,
  borderRadius: 3,
  background: 'rgba(0,0,0,0.08)',
  overflow: 'hidden',
};
const fill: CSSProperties = { height: '100%', background: 'var(--forest, #3f7a52)', transition: 'width 0.3s linear' };
const row: CSSProperties = { display: 'flex', gap: 10 };
const btn: CSSProperties = {
  padding: '12px 24px',
  borderRadius: 14,
  border: 'none',
  fontWeight: 800,
  fontSize: 15,
  color: '#fff',
  background: 'var(--forest, #3f7a52)',
  cursor: 'pointer',
};
const btnGhost: CSSProperties = { background: 'transparent', color: 'var(--forest, #3f7a52)', opacity: 0.8 };
