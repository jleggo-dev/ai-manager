import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { StepLog } from '../state.ts';
import { TONE, RING_C } from './tone.ts';
import { playChime } from './chime.ts';

type TimerLog = Extract<StepLog, { kind: 'timer' }>;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * Timer tool (walkthrough v2, design E) — the ring is the clock (one continuous arc), the centre
 * counts m:ss down. One tone button toggles Start ⇄ Pause; +1 min / Reset / Chime sit below. It is
 * the only step that auto-advances: on completion it chimes, logs the full duration, and moves on.
 * Pausing captures partial elapsed (recap shows partial, not skipped). (The 5 s pre-roll grace is a
 * follow-up refinement.)
 */
export function StepTimer({
  seconds,
  chime,
  log,
  onLog,
  onDone,
}: {
  seconds: number;
  chime: boolean;
  nextTitle?: string;
  log?: TimerLog;
  onLog: (l: TimerLog) => void;
  onDone: () => void;
}) {
  const [elapsed, setElapsed] = useState(log?.done ? seconds : (log?.elapsedSec ?? 0));
  const [running, setRunning] = useState(false);
  const [chimeOn, setChimeOn] = useState(chime);
  const finished = useRef(log?.done ?? false);
  const remaining = Math.max(0, seconds - elapsed);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed((e) => Math.min(seconds, e + 1)), 1000);
    return () => clearInterval(id);
  }, [running, seconds]);

  useEffect(() => {
    if (elapsed >= seconds && !finished.current) {
      finished.current = true;
      setRunning(false);
      if (chimeOn) playChime();
      onLog({ kind: 'timer', elapsedSec: seconds, targetSec: seconds, done: true });
      const t = setTimeout(onDone, 600);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [elapsed, seconds, chimeOn, onLog, onDone]);

  function toggle() {
    if (running) {
      setRunning(false);
      onLog({ kind: 'timer', elapsedSec: elapsed, targetSec: seconds, done: false });
    } else {
      setRunning(true);
    }
  }

  const frac = seconds > 0 ? elapsed / seconds : 0;

  return (
    <div style={card}>
      <div
        style={{ position: 'relative', height: 190, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <svg width="190" height="190" viewBox="0 0 128 128" style={{ position: 'absolute' }} aria-hidden>
          <circle cx="64" cy="64" r="54" fill="none" strokeWidth={13} stroke={TONE.track} />
          <circle
            cx="64"
            cy="64"
            r="54"
            fill="none"
            strokeWidth={13}
            strokeLinecap="round"
            stroke={TONE.fillA}
            strokeDasharray={`${RING_C * frac} ${RING_C}`}
            transform="rotate(-90 64 64)"
            style={{ transition: 'stroke-dasharray 1s linear' }}
          />
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <div
            style={{
              fontFamily: 'var(--display), serif',
              fontWeight: 600,
              fontSize: 46,
              lineHeight: 1,
              color: TONE.ink,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {mmss(remaining)}
          </div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 900,
              letterSpacing: '0.09em',
              textTransform: 'uppercase',
              color: TONE.sub,
            }}
          >
            left of {mmss(seconds)}
          </div>
        </div>
      </div>

      <button style={logBtn} onClick={toggle}>
        {running ? 'Pause' : elapsed > 0 ? 'Resume' : `Start · ${Math.round(seconds / 60) || 1} min`}
      </button>

      <div style={{ display: 'flex', gap: 8 }}>
        <button style={secBtn} onClick={() => setElapsed((e) => Math.max(0, e - 60))}>
          +1 min
        </button>
        <button
          style={secBtn}
          onClick={() => {
            setRunning(false);
            finished.current = false;
            setElapsed(0);
          }}
        >
          Reset
        </button>
        <button style={{ ...secBtn, ...(chimeOn ? chimeOnStyle : null) }} onClick={() => setChimeOn((v) => !v)}>
          {chimeOn ? '🔔 Chime' : 'Chime off'}
        </button>
      </div>

      <div
        style={{
          borderTop: '1px solid oklch(93% 0.012 85)',
          paddingTop: 12,
          fontSize: 11.5,
          lineHeight: 1.4,
          color: 'oklch(48% 0.02 150)',
        }}
      >
        Logs {Math.round(seconds / 60) || 1} min and moves on when it ends. Pausing keeps the time you&apos;ve done.
      </div>
    </div>
  );
}

const card: CSSProperties = {
  background: 'white',
  border: '1px solid oklch(91% 0.015 85)',
  borderRadius: 18,
  padding: 18,
  boxShadow: '0 1px 3px oklch(0% 0 0 / 0.04)',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};
const logBtn: CSSProperties = {
  border: 'none',
  borderRadius: 16,
  padding: 15,
  fontSize: 15,
  fontWeight: 900,
  color: 'white',
  cursor: 'pointer',
  background: `linear-gradient(180deg, ${TONE.fillA} 0%, ${TONE.fillB} 46%)`,
  boxShadow: `0 5px 0 ${TONE.deep}`,
};
const secBtn: CSSProperties = {
  flex: 1,
  textAlign: 'center',
  background: 'white',
  border: '1.5px solid oklch(90% 0.015 95)',
  borderRadius: 12,
  padding: '10px 0',
  fontSize: 12,
  fontWeight: 900,
  color: 'oklch(40% 0.02 150)',
  cursor: 'pointer',
};
const chimeOnStyle: CSSProperties = {
  background: 'oklch(97% 0.02 74)',
  border: '1.5px solid oklch(86% 0.04 66)',
  color: TONE.chipInk,
};
