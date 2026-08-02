import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { RETURNS_FOOTER, type MeditateBells, returnsSentence, ringsAt, sitLogLine } from '@cadence/shared';
import type { StepLog } from '../state.ts';
import { TONE, RING_C } from './tone.ts';
import { playChime } from './chime.ts';

type MeditateLog = Extract<StepLog, { kind: 'meditate' }>;

const PREROLL = 5;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * A held quiet (REQ9 §4.2) — the ring is the clock, and the whole card is the **"came back" tap**.
 *
 * The tap is the piece with rules. It records that attention wandered and returned, and:
 *   • **no running count ever appears on screen.** A visible tally would turn wandering into
 *     something being measured while you are trying not to measure things, and the fourth tap
 *     would start to feel like a confession. The count lives in the log alone.
 *   • **the screen after a tap is identical to the screen before it** — one ripple, no sound, no
 *     mark that accumulates. You returned; the sit continues as if you had never left, because
 *     that is what returning means.
 *   • the visible pill is deliberately the lowest-contrast control we ship. It exists to teach the
 *     gesture once; a bright button would invite performance.
 *   • **zero taps shows no closing sentence at all** — zero could be a settled sit or a forgotten
 *     gesture, and the app must not guess which, nor congratulate "perfect focus".
 */
export function StepMeditate({
  seconds,
  bells,
  intervalMin,
  title,
  log,
  onLog,
  onDone,
}: {
  seconds: number;
  bells: MeditateBells;
  intervalMin: number;
  title?: string;
  log?: MeditateLog;
  onLog: (l: MeditateLog) => void;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<'idle' | 'preroll' | 'running' | 'closed'>('idle');
  const [preroll, setPreroll] = useState(PREROLL);
  const [elapsed, setElapsed] = useState(log?.done ? seconds : (log?.elapsedSec ?? 0));
  const [returns, setReturns] = useState(log?.returns ?? 0);
  const [ripples, setRipples] = useState<number[]>([]);
  const finished = useRef(log?.done ?? false);
  const minutes = Math.max(1, Math.round(seconds / 60));
  const remaining = Math.max(0, seconds - elapsed);

  useEffect(() => {
    if (phase !== 'preroll') return undefined;
    if (preroll <= 0) {
      setPhase('running');
      if (bells !== 'none') playChime();
      return undefined;
    }
    const id = setTimeout(() => setPreroll((p) => p - 1), 1000);
    return () => clearTimeout(id);
  }, [phase, preroll, bells]);

  useEffect(() => {
    if (phase !== 'running') return undefined;
    const id = setInterval(() => setElapsed((e) => Math.min(seconds, e + 1)), 1000);
    return () => clearInterval(id);
  }, [phase, seconds]);

  // Interval and end bells come off the shared schedule, so the clock and the bells can't drift.
  useEffect(() => {
    if (phase === 'running' && elapsed > 0 && ringsAt(elapsed, minutes, bells, intervalMin)) playChime();
  }, [phase, elapsed, minutes, bells, intervalMin]);

  useEffect(() => {
    if (phase === 'running' && elapsed >= seconds && !finished.current) {
      finished.current = true;
      setPhase('closed');
      onLog({ kind: 'meditate', elapsedSec: seconds, targetSec: seconds, returns, done: true });
    }
  }, [phase, elapsed, seconds, returns, onLog]);

  /** A return. One ripple, nothing else — see the rules in the component doc. */
  function cameBack() {
    if (phase !== 'running') return;
    const id = Date.now() + Math.random();
    setReturns((n) => n + 1);
    setRipples((r) => [...r, id]);
    navigator.vibrate?.(8);
    setTimeout(() => setRipples((r) => r.filter((x) => x !== id)), 900);
  }

  function primary() {
    if (phase === 'running') {
      setPhase('closed');
      onLog({ kind: 'meditate', elapsedSec: elapsed, targetSec: seconds, returns, done: false });
    } else if (phase === 'preroll') {
      setPhase('running');
    } else {
      finished.current = false;
      setPreroll(PREROLL);
      setPhase('preroll');
    }
  }

  if (phase === 'closed') {
    const sentence = returnsSentence(returns);
    return (
      <div style={card}>
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 0' }}>
          <div style={{ ...bigLine, fontSize: 19 }}>{sitLogLine(elapsed, seconds)}</div>
          {sentence ? (
            <>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'oklch(40% 0.02 150)' }}>{sentence}</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.45, color: 'oklch(52% 0.02 150)' }}>{RETURNS_FOOTER}</div>
            </>
          ) : null}
        </div>
        <button style={primaryBtn} onClick={onDone}>
          Done
        </button>
      </div>
    );
  }

  const isPre = phase === 'preroll';
  const isRun = phase === 'running';
  const frac = isPre ? preroll / PREROLL : seconds > 0 ? elapsed / seconds : 0;

  return (
    // The whole card is the target: thumb-reachable, eyes closed, on a dimmed screen.
    <div style={{ ...card, cursor: isRun ? 'pointer' : 'default' }} onClick={isRun ? cameBack : undefined}>
      <div style={stage}>
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
        {ripples.map((id) => (
          <span key={id} style={ripple} />
        ))}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <div style={{ ...bigLine, color: isPre ? 'oklch(55% 0.02 150)' : TONE.ink }}>
            {isPre ? preroll : mmss(remaining)}
          </div>
          {!isPre && <div style={caps}>{isRun ? 'sitting' : `${minutes} min`}</div>}
        </div>
      </div>

      {isPre && (
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={caps}>Get settled</div>
          {/* Offered once, here, and never explained again. */}
          <div style={{ fontSize: 11.5, lineHeight: 1.4, color: 'oklch(48% 0.02 150)' }}>
            If you notice you&apos;ve drifted, tap anywhere — that&apos;s the practice, not a mistake.
          </div>
        </div>
      )}

      {/* No onClick of its own: the card already handles the tap, and adding one here would fire
          both handlers and count a single return twice. The pill teaches the gesture; the target
          is the whole card. */}
      {isRun && (
        <button style={cameBackBtn} aria-label="I came back">
          I came back
        </button>
      )}

      <button
        style={isPre ? greyBtn : primaryBtn}
        onClick={(e) => {
          e.stopPropagation(); // never let ending the sit read as a return
          primary();
        }}
      >
        {isRun
          ? 'End here'
          : isPre
            ? 'Skip the count · start now'
            : elapsed > 0
              ? 'Sit again'
              : `Begin · ${minutes} min`}
      </button>

      {!isRun && (
        <div style={footnote}>
          {title ? `${title} · ` : ''}
          {minutes} min
          {bells === 'none'
            ? ', no bells'
            : bells === 'interval'
              ? `, a bell every ${intervalMin} min`
              : ', a bell to start and end'}
          . Stopping early keeps the time you sat.
        </div>
      )}
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
  gap: 12,
};
const stage: CSSProperties = {
  position: 'relative',
  width: 190,
  height: 190,
  alignSelf: 'center',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
const ripple: CSSProperties = {
  position: 'absolute',
  width: 190,
  height: 190,
  borderRadius: '50%',
  border: '1px solid oklch(76% 0.10 58 / 0.35)',
  animation: 'cadence-ripple 900ms ease-out forwards',
  pointerEvents: 'none',
};
const bigLine: CSSProperties = {
  fontFamily: 'var(--display), serif',
  fontWeight: 600,
  fontSize: 44,
  lineHeight: 1,
  fontVariantNumeric: 'tabular-nums',
  color: TONE.ink,
};
const caps: CSSProperties = {
  fontSize: 10,
  fontWeight: 900,
  letterSpacing: '0.09em',
  textTransform: 'uppercase',
  color: TONE.sub,
};
/** Deliberately the lowest-contrast control in the product — it teaches the gesture, it doesn't sell it. */
const cameBackBtn: CSSProperties = {
  border: '1.5px solid oklch(88% 0.012 268)',
  background: 'transparent',
  borderRadius: 16,
  padding: '15px 0',
  fontSize: 15,
  fontWeight: 700,
  color: 'oklch(58% 0.02 268)',
  cursor: 'pointer',
};
const primaryBtn: CSSProperties = {
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
const footnote: CSSProperties = {
  borderTop: '1px solid oklch(93% 0.012 85)',
  paddingTop: 12,
  fontSize: 11.5,
  lineHeight: 1.4,
  color: 'oklch(48% 0.02 150)',
};
