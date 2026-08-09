import { useState, type CSSProperties } from 'react';
import type { CircuitExercise, WalkthroughStep } from '@cadence/shared';
import type { StepLog } from '../state.ts';
import { TONE, RING_C } from './tone.ts';
import { YouTubeLink } from './YouTubeLink.tsx';
import { useHandsFree, type HandsFreeCommand } from './useHandsFree.ts';
import { HandsFree } from './HandsFree.tsx';

type CircuitLog = Extract<StepLog, { kind: 'circuit' }>;
const GAP = 10;
/** A circuit has no clock, so there is nothing to start, pause or skip — the only thing voice can
 *  usefully do is what the thumb does: log the move you just finished and move on. */
const CIRCUIT_COMMANDS: HandsFreeCommand[] = ['next'];
const ordinal = (i: number) => ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'][i] ?? `${i + 1}th`;

/**
 * Circuit tool (walkthrough v2, design B) — one cohesive nested player, three bands: (1) a rounds
 * ring header ("Round 2 of 3 · move 1 of 4"); (2) the current move's own tool (a reps dial or a
 * timed-hold target); (3) the tone primary that logs + advances, over the rotation list. The ring
 * belongs to the ROUNDS; completed rounds fill deep, the current round fills pro-rata by moves done.
 * "Skip circuit" (the shell's nav) leaves the loop, not the workout. Captures rounds done.
 */
export function StepCircuit({
  step,
  rounds,
  exercises,
  log,
  onLog,
  onAdvance,
}: {
  step: WalkthroughStep;
  rounds: number;
  exercises: CircuitExercise[];
  log?: CircuitLog;
  onLog: (l: CircuitLog) => void;
  onAdvance: () => void;
}) {
  const n = exercises.length;
  const [round, setRound] = useState(log?.roundsDone ?? 0); // completed rounds
  const [pos, setPos] = useState(0); // move index in the current round
  const [dial, setDial] = useState<number | null>(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const complete = round >= rounds;
  const ex = exercises[Math.min(pos, n - 1)]!;
  const lastMove = pos >= n - 1;
  const lastRound = round >= rounds - 1;
  const reps = ex.reps != null ? (dial == null ? ex.reps : dial) : null;

  function logMove() {
    if (complete) return;
    setDial(null);
    if (pos + 1 < n) {
      setPos(pos + 1);
    } else {
      const nr = round + 1;
      setRound(nr);
      setPos(0);
      onLog({ kind: 'circuit', roundsDone: nr, totalRounds: rounds });
      if (nr >= rounds) onAdvance();
    }
  }

  // "next", never "skip": on a circuit the word means "I finished that one", and it LOGS the move.
  // Answering to "skip" here would throw a rep away on a word that promised the opposite.
  const voice = useHandsFree(voiceOn, () => logMove(), CIRCUIT_COMMANDS);

  const wedge = RING_C / rounds;
  const arc = Math.max(2, wedge - GAP);
  const roundFrac = pos / n;
  const centreRound = complete ? rounds : Math.min(round + 1, rounds);

  const primaryLabel = complete
    ? '✓ Circuit done'
    : lastMove && lastRound
      ? `Log ${reps ?? ''} · finish circuit`.replace(' ·', reps == null ? ' ·' : ' ·')
      : lastMove
        ? `Log round ${round + 1} ›`
        : `Log ${reps ?? 'move'} · next move ›`;

  return (
    <>
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
        <div style={badge}>
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth={2.4}
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M20 12a8 8 0 1 1-2.6-5.9" />
            <path d="M20 4v4h-4" />
          </svg>
          <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Circuit
          </span>
        </div>
        <div style={{ fontSize: 21, fontWeight: 800, color: TONE.ink2 }}>{step.title}</div>
      </div>

      <div style={{ ...card, marginTop: 16 }}>
        {/* band 1 — round header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 86,
              height: 86,
              flex: 'none',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="86" height="86" viewBox="0 0 128 128" style={{ position: 'absolute' }} aria-hidden>
              {Array.from({ length: rounds }).map((_, i) => (
                <circle
                  key={i}
                  cx="64"
                  cy="64"
                  r="54"
                  fill="none"
                  strokeWidth={15}
                  strokeLinecap="round"
                  stroke={i < round ? TONE.deep : TONE.track}
                  strokeDasharray={`${arc} ${RING_C - arc}`}
                  strokeDashoffset={-(i * wedge)}
                  transform="rotate(-90 64 64)"
                />
              ))}
              {!complete && roundFrac > 0 && (
                <circle
                  cx="64"
                  cy="64"
                  r="54"
                  fill="none"
                  strokeWidth={15}
                  strokeLinecap="round"
                  stroke={TONE.fillA}
                  strokeDasharray={`${Math.max(1, arc * roundFrac)} ${RING_C}`}
                  strokeDashoffset={-(round * wedge)}
                  transform="rotate(-90 64 64)"
                />
              )}
            </svg>
            <div
              style={{
                fontFamily: 'var(--display), serif',
                fontWeight: 600,
                fontSize: 26,
                lineHeight: 1,
                color: TONE.ink,
              }}
            >
              {centreRound}
              <span style={{ fontSize: 16, color: TONE.sub }}>/{rounds}</span>
            </div>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 900,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: TONE.deep,
              }}
            >
              Round {Math.min(round + 1, rounds)} of {rounds}
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 700, lineHeight: 1.35, color: TONE.sub }}>
              {complete ? 'All rounds done' : `Move ${pos + 1} of ${n}`}
            </div>
          </div>
        </div>

        {/* band 2 — the current move's tool */}
        {!complete && (
          <div
            style={{
              borderTop: '1px solid oklch(93% 0.012 85)',
              paddingTop: 13,
              display: 'flex',
              flexDirection: 'column',
              gap: 11,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={{ flex: 1, fontSize: 17, fontWeight: 900, color: TONE.ink2 }}>{ex.name}</div>
              <div style={targetPill}>
                {ex.reps != null ? `Target ${ex.reps}` : ex.seconds ? `Target ${ex.seconds} s` : 'Target'}
              </div>
              {ex.video_query && (
                <YouTubeLink query={ex.video_query} label={ex.reps != null ? 'Form' : 'Follow along'} />
              )}
            </div>
            {ex.reps != null ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
                <button
                  style={miniDial}
                  onClick={() => setDial(Math.max(0, (reps ?? 0) - 1))}
                  aria-label="one fewer rep"
                >
                  −
                </button>
                <div style={{ textAlign: 'center', minWidth: 76 }}>
                  <div
                    style={{
                      fontFamily: 'var(--display), serif',
                      fontWeight: 600,
                      fontSize: 38,
                      lineHeight: 1,
                      color: TONE.ink,
                    }}
                  >
                    {reps}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 900,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: TONE.sub,
                      marginTop: 2,
                    }}
                  >
                    reps
                  </div>
                </div>
                <button
                  style={miniDial}
                  onClick={() => setDial(Math.min(99, (reps ?? 0) + 1))}
                  aria-label="one more rep"
                >
                  +
                </button>
              </div>
            ) : (
              <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 800, color: TONE.sub }}>
                {ex.seconds ? `${ex.seconds}s hold — self-timed` : 'do the move'}
              </div>
            )}
          </div>
        )}

        {/* band 3 — primary + rotation list */}
        <button style={{ ...logBtn, ...(complete ? { opacity: 0.62 } : null) }} onClick={logMove} disabled={complete}>
          {primaryLabel}
        </button>

        {!complete && <HandsFree state={voice} on={voiceOn} onToggle={() => setVoiceOn((v) => !v)} />}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {exercises.map((e, i) => {
            const isCurrent = !complete && i === pos;
            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 10px',
                  borderRadius: 12,
                  background: 'white',
                  border: isCurrent ? `1.5px solid ${TONE.fillA}` : '1px solid transparent',
                  boxShadow: isCurrent ? '0 0 0 3px oklch(79% 0.16 70 / 0.16)' : undefined,
                }}
              >
                <div
                  style={{
                    width: 15,
                    height: 15,
                    flex: 'none',
                    borderRadius: '50%',
                    border: `2px solid ${isCurrent ? TONE.fillA : 'oklch(88% 0.02 85)'}`,
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <div
                    style={{
                      fontSize: isCurrent ? 13.5 : 12.5,
                      fontWeight: isCurrent ? 900 : 700,
                      color: isCurrent ? TONE.ink : TONE.sub,
                    }}
                  >
                    {e.name}
                  </div>
                  {isCurrent && (
                    <div style={{ fontSize: 10.5, fontWeight: 800, color: TONE.deep }}>
                      Now · {ordinal(pos)} of {n}
                    </div>
                  )}
                </div>
                <div
                  style={{
                    ...toolPill,
                    ...(isCurrent ? { background: 'oklch(97% 0.02 74)', color: TONE.chipInk } : null),
                  }}
                >
                  {e.reps != null ? 'Reps' : 'Timer'}
                </div>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: TONE.sub, width: 52, textAlign: 'right' }}>
                  {e.reps != null ? `${e.reps}` : `${e.seconds ?? ''} s`}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

const card: CSSProperties = {
  background: 'white',
  border: '1px solid oklch(91% 0.015 85)',
  borderRadius: 18,
  padding: 16,
  boxShadow: '0 1px 3px oklch(0% 0 0 / 0.04)',
  display: 'flex',
  flexDirection: 'column',
  gap: 13,
};
const badge: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  background: TONE.deep,
  color: 'white',
  borderRadius: 999,
  padding: '5px 12px',
};
const targetPill: CSSProperties = {
  background: 'oklch(97% 0.012 85)',
  border: '1px solid oklch(91% 0.015 85)',
  borderRadius: 999,
  padding: '5px 10px',
  fontSize: 10.5,
  fontWeight: 900,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: TONE.sub,
  whiteSpace: 'nowrap',
  flex: 'none',
};
const miniDial: CSSProperties = {
  width: 50,
  height: 44,
  flex: 'none',
  border: 'none',
  borderRadius: 999,
  background: 'linear-gradient(180deg,#fff 0%,oklch(96% 0.01 85) 46%)',
  boxShadow: '0 4px 0 oklch(88% 0.02 85), 0 0 0 1px oklch(92% 0.015 85)',
  fontSize: 24,
  fontWeight: 800,
  color: 'oklch(40% 0.02 150)',
  cursor: 'pointer',
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
const toolPill: CSSProperties = {
  background: 'oklch(97% 0.012 85)',
  borderRadius: 999,
  padding: '2px 6px',
  fontSize: 8.5,
  fontWeight: 900,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: TONE.sub,
};
