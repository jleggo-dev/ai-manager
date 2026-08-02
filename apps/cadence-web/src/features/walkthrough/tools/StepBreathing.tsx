import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { type BreathPattern, breathFullness, cycleSeconds, patternCounts, phaseAt } from '@cadence/shared';
import type { StepLog } from '../state.ts';
import { TONE } from './tone.ts';
import { playChime } from './chime.ts';
import { useBreathClock } from './useBreathClock.ts';

type BreathingLog = Extract<StepLog, { kind: 'breathing' }>;

const PREROLL = 5;
/** The form breathes between these radii — big enough to follow at arm's length, small enough to
 *  leave the phase label readable inside it. */
const R_MIN = 46;
const R_MAX = 96;

/**
 * The breath pacer (REQ9 §4.1). One expanding form and a travelling count — you follow the light,
 * the device owns the timing, and there is nothing to count. It animates whatever pattern it is
 * handed, so box, 4-7-8, the double breath and side-to-side are all the same component with
 * different data.
 *
 * Position is a pure function of elapsed time (`phaseAt`), never accumulated state — a dropped
 * frame or a backgrounded tab can't desynchronize the animation from the count. The grey 5 s
 * pre-roll is borrowed from `StepTimer` (the phone is on the floor by second two) and is never
 * logged. Stopping early logs the rounds actually completed: partial is the normal case, and the
 * copy never says "incomplete".
 */
export function StepBreathing({
  pattern,
  cycles,
  caution,
  title,
  log,
  onLog,
  onDone,
}: {
  pattern: BreathPattern;
  cycles: number;
  caution?: string;
  /** The coach's own name for this step, when there is one. Inside the walkthrough a header
   *  already shows it, so the card names the RHYTHM instead and never competes; standalone (the
   *  extras menu, the dev preview) there is no header, so the card falls back to the pattern's
   *  own name rather than going unlabelled. */
  title?: string;
  log?: BreathingLog;
  onLog: (l: BreathingLog) => void;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<'idle' | 'preroll' | 'running'>('idle');
  const [preroll, setPreroll] = useState(PREROLL);
  const finished = useRef(log ? log.roundsDone >= log.totalRounds : false);
  const elapsed = useBreathClock(phase === 'running');

  const per = cycleSeconds(pattern);
  const at = phaseAt(pattern, cycles, elapsed);
  const roundsDone = at.done ? cycles : at.cycle;

  useEffect(() => {
    if (phase !== 'preroll') return undefined;
    if (preroll <= 0) {
      setPhase('running');
      return undefined;
    }
    const id = setTimeout(() => setPreroll((p) => p - 1), 1000);
    return () => clearTimeout(id);
  }, [phase, preroll]);

  useEffect(() => {
    if (phase === 'running' && at.done && !finished.current) {
      finished.current = true;
      setPhase('idle');
      playChime();
      onLog({ kind: 'breathing', roundsDone: cycles, totalRounds: cycles, pattern: pattern.id });
      const t = setTimeout(onDone, 700);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [phase, at.done, cycles, pattern.id, onLog, onDone]);

  function primary() {
    if (phase === 'running') {
      setPhase('idle');
      onLog({ kind: 'breathing', roundsDone, totalRounds: cycles, pattern: pattern.id });
    } else if (phase === 'preroll') {
      setPhase('running');
    } else {
      finished.current = false;
      setPreroll(PREROLL);
      setPhase('preroll');
    }
  }

  const isPre = phase === 'preroll';
  const isRun = phase === 'running';
  // The form fills through an in-breath, empties through an out-breath, and holds its size on a
  // hold — so the shape alone tells you what to do, before you read anything. Fullness comes from
  // the shared maths, which treats consecutive inhales as one continuous run (the double breath
  // tops up rather than restarting).
  const radius = isRun
    ? R_MIN + (R_MAX - R_MIN) * breathFullness(pattern, at.phaseIndex, at.progress)
    : R_MIN + (R_MAX - R_MIN) * 0.35;

  return (
    <div style={card}>
      <div style={stage}>
        <svg width="230" height="230" viewBox="0 0 230 230" aria-hidden style={{ position: 'absolute' }}>
          <circle cx="115" cy="115" r={R_MAX} fill="none" stroke="oklch(94% 0.015 85)" strokeWidth={1.5} />
          <circle
            cx="115"
            cy="115"
            r={radius}
            fill={isPre ? 'oklch(96% 0.006 250)' : 'oklch(93% 0.05 68)'}
            stroke={isPre ? 'oklch(88% 0.008 250)' : TONE.fillA}
            strokeWidth={2}
            style={{ transition: isRun ? 'r 240ms linear, fill 600ms linear' : 'r 400ms ease-out' }}
          />
        </svg>
        <div style={centre}>
          {isPre ? (
            <>
              <div style={{ ...bigNum, color: 'oklch(55% 0.02 150)' }}>{preroll}</div>
              <div style={caps}>Get settled</div>
            </>
          ) : (
            <>
              {/* Before you start, the card names the RHYTHM you're about to follow ("4 · 7 · 8"),
                  not the practice — the header (or the title prop) already named that. */}
              <div style={phaseLabel}>{isRun ? at.phase.label : (title ?? pattern.name)}</div>
              {isRun ? (
                <div style={bigNum}>{Math.ceil(at.remaining)}</div>
              ) : (
                /* Counts only — the dot row below already IS the round count, and the pair
                   together overflowed the form on longer patterns. */
                <div style={{ ...caps, marginTop: 4 }}>{patternCounts(pattern)}</div>
              )}
            </>
          )}
        </div>
      </div>

      {/* The per-phase cue — which nostril, the sigh's second inhale. Reserved height so the
          layout never jumps when a pattern has cues on some phases and not others. */}
      <div style={cueLine}>{isRun && at.phase.cue ? at.phase.cue : isRun ? ' ' : pattern.summary}</div>

      <div style={dots} aria-label={`round ${Math.min(roundsDone + 1, cycles)} of ${cycles}`}>
        {Array.from({ length: cycles }, (_, i) => (
          <span key={i} style={{ ...dot, ...(i < roundsDone ? dotDone : i === roundsDone && isRun ? dotNow : null) }} />
        ))}
      </div>

      <button style={isPre ? greyBtn : primaryBtn} onClick={primary}>
        {isRun ? 'Stop here' : isPre ? 'Skip the count · start now' : roundsDone > 0 ? 'Go again' : 'Begin'}
      </button>

      {caution ? <div style={cautionLine}>{caution}</div> : null}

      <div style={footnote}>
        {patternCounts(pattern)} · {cycles} rounds · about {Math.max(1, Math.round((per * cycles) / 60))} min. Stopping
        early keeps the rounds you did.
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
  gap: 12,
  alignItems: 'stretch',
};
const stage: CSSProperties = {
  position: 'relative',
  width: 230,
  height: 230,
  alignSelf: 'center',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
const centre: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 2,
  pointerEvents: 'none',
};
const bigNum: CSSProperties = {
  fontFamily: 'var(--display), serif',
  fontWeight: 600,
  fontSize: 40,
  lineHeight: 1,
  color: TONE.ink,
  fontVariantNumeric: 'tabular-nums',
};
const phaseLabel: CSSProperties = {
  fontFamily: 'var(--display), serif',
  fontWeight: 600,
  fontSize: 22,
  lineHeight: 1.1,
  color: TONE.ink,
};
const caps: CSSProperties = {
  fontSize: 10,
  fontWeight: 900,
  letterSpacing: '0.09em',
  textTransform: 'uppercase',
  color: TONE.sub,
};
const cueLine: CSSProperties = {
  minHeight: 32,
  textAlign: 'center',
  fontSize: 12.5,
  lineHeight: 1.35,
  fontWeight: 700,
  color: 'oklch(48% 0.02 150)',
  padding: '0 8px',
};
const dots: CSSProperties = { display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' };
const dot: CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: '50%',
  background: 'oklch(92% 0.012 85)',
  display: 'inline-block',
};
const dotDone: CSSProperties = { background: TONE.fillA };
const dotNow: CSSProperties = { background: TONE.fillB, transform: 'scale(1.35)' };
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
const cautionLine: CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  lineHeight: 1.4,
  color: 'oklch(45% 0.06 52)',
  background: 'oklch(97% 0.02 74)',
  border: '1px solid oklch(90% 0.04 66)',
  borderRadius: 12,
  padding: '9px 11px',
};
const footnote: CSSProperties = {
  borderTop: '1px solid oklch(93% 0.012 85)',
  paddingTop: 12,
  fontSize: 11.5,
  lineHeight: 1.4,
  color: 'oklch(48% 0.02 150)',
};
