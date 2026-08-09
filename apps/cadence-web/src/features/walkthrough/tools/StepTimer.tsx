import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { StepLog } from '../state.ts';
import { TONE, RING_C } from './tone.ts';
import { playChime } from './chime.ts';
import { useHandoff } from './useHandoff.ts';

type TimerLog = Extract<StepLog, { kind: 'timer' }>;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const PREROLL = 5;

/**
 * Timer tool (walkthrough v2, design E) — the ring is the clock (one continuous arc), the centre
 * counts m:ss down. Start hands to a **5 s grey pre-roll** (design B3): a cool-grey sweep counting
 * 5→1 with "Get in position", because the phone is on the floor by second two; pre-roll seconds are
 * never logged. At zero the ring resets to full and turns tone, the real clock runs. One tone button
 * toggles Start ⇄ (Skip the count) ⇄ Pause; +1 min / Reset / Chime sit below. One of the steps that
 * auto-advance (see `useHandoff`): on completion it chimes, logs the full duration, and moves on
 * without a tap — Reset inside that window keeps you here. Pause captures
 * partial elapsed (recap shows partial, not skipped); Resume skips the pre-roll.
 */
export function StepTimer({
  seconds,
  chime,
  nextTitle,
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
  const [phase, setPhase] = useState<'idle' | 'preroll' | 'running'>('idle');
  const [preroll, setPreroll] = useState(PREROLL);
  const [elapsed, setElapsed] = useState(log?.done ? seconds : (log?.elapsedSec ?? 0));
  const [chimeOn, setChimeOn] = useState(chime);
  const finished = useRef(log?.done ?? false);
  const handoff = useHandoff();
  const remaining = Math.max(0, seconds - elapsed);

  useEffect(() => {
    if (phase !== 'preroll') return undefined;
    if (preroll <= 0) {
      setPhase('running');
      if (chimeOn) playChime();
      return undefined;
    }
    const id = setTimeout(() => setPreroll((p) => p - 1), 1000);
    return () => clearTimeout(id);
  }, [phase, preroll, chimeOn]);

  useEffect(() => {
    if (phase !== 'running') return undefined;
    const id = setInterval(() => setElapsed((e) => Math.min(seconds, e + 1)), 1000);
    return () => clearInterval(id);
  }, [phase, seconds]);

  useEffect(() => {
    if (phase === 'running' && elapsed >= seconds && !finished.current) {
      finished.current = true;
      setPhase('idle');
      if (chimeOn) playChime();
      onLog({ kind: 'timer', elapsedSec: seconds, targetSec: seconds, done: true });
      handoff.schedule(onDone, 600);
    }
  }, [phase, elapsed, seconds, chimeOn, onLog, onDone, handoff]);

  function primary() {
    if (phase === 'running') {
      setPhase('idle');
      onLog({ kind: 'timer', elapsedSec: elapsed, targetSec: seconds, done: false });
    } else if (phase === 'preroll') {
      setPhase('running'); // skip the count
    } else if (elapsed > 0) {
      setPhase('running'); // resume — no pre-roll
    } else {
      setPreroll(PREROLL);
      setPhase('preroll');
    }
  }

  const isPre = phase === 'preroll';
  const frac = isPre ? preroll / PREROLL : seconds > 0 ? elapsed / seconds : 0;

  return (
    <div style={card}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <div
          style={{
            position: 'relative',
            width: 190,
            height: 190,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="190" height="190" viewBox="0 0 128 128" style={{ position: 'absolute' }} aria-hidden>
            <circle
              cx="64"
              cy="64"
              r="54"
              fill="none"
              strokeWidth={13}
              stroke={isPre ? 'oklch(94% 0.015 85)' : TONE.track}
            />
            {frac > 0 && (
              <circle
                cx="64"
                cy="64"
                r="54"
                fill="none"
                strokeWidth={13}
                strokeLinecap="round"
                stroke={isPre ? 'oklch(78% 0.008 250)' : TONE.fillA}
                strokeDasharray={`${RING_C * frac} ${RING_C}`}
                transform="rotate(-90 64 64)"
                style={{ transition: isPre ? 'none' : 'stroke-dasharray 1s linear' }}
              />
            )}
          </svg>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <div
              style={{
                fontFamily: 'var(--display), serif',
                fontWeight: 600,
                fontSize: isPre ? 44 : 46,
                lineHeight: 1,
                color: isPre ? 'oklch(55% 0.02 150)' : TONE.ink,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {isPre ? preroll : mmss(remaining)}
            </div>
            {!isPre && (
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
            )}
          </div>
        </div>
        {isPre && (
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 900,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: TONE.sub,
                whiteSpace: 'nowrap',
              }}
            >
              Get in position
            </div>
            <div style={{ fontSize: 11, fontWeight: 800, color: TONE.sub, marginTop: 3, whiteSpace: 'nowrap' }}>
              {mmss(seconds)} starts when the grey runs out
            </div>
          </div>
        )}
      </div>

      <button style={isPre ? greyBtn : logBtn} onClick={primary}>
        {phase === 'running'
          ? 'Pause'
          : isPre
            ? 'Skip the count · start now'
            : elapsed > 0
              ? 'Resume'
              : `Start · ${Math.round(seconds / 60) || 1} min`}
      </button>

      {!isPre && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={secBtn} onClick={() => setElapsed((e) => Math.max(0, e - 60))}>
            +1 min
          </button>
          <button
            style={secBtn}
            onClick={() => {
              handoff.cancel(); // Reset inside the 600 ms hand-off means stay here, don't move on.
              setPhase('idle');
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
      )}

      <div style={footnote}>
        Logs {Math.round(seconds / 60) || 1} min and {nextTitle ? `moves to ${nextTitle} on its own` : 'moves on'} when
        it ends. Pausing keeps the time you&apos;ve done.
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
const greyBtn: CSSProperties = {
  border: 'none',
  borderRadius: 16,
  padding: 15,
  fontSize: 15,
  fontWeight: 900,
  color: 'oklch(42% 0.02 150)',
  cursor: 'pointer',
  background: 'linear-gradient(180deg, oklch(96% 0.008 85) 0%, oklch(93% 0.01 85) 46%)',
  boxShadow: '0 5px 0 oklch(87% 0.015 85)',
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
const footnote: CSSProperties = {
  borderTop: '1px solid oklch(93% 0.012 85)',
  paddingTop: 12,
  fontSize: 11.5,
  lineHeight: 1.4,
  color: 'oklch(48% 0.02 150)',
};
