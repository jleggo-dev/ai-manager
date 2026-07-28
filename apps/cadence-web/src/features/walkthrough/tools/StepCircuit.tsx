import { useState, type CSSProperties } from 'react';
import type { CircuitExercise } from '@cadence/shared';
import { ytSearch } from '../../plan/occurrence/format.ts';

const FOREST = 'var(--forest, #3f7a52)';
const MUTED = 'rgba(0,0,0,0.10)';

/**
 * The **circuit** tool (REQ8 slice 2) — a block the coach marked `circuit` plays as one cohesive
 * unit: rotate through the exercises for N rounds (A,B,A,B). The ring is the ROUNDS (filling as each
 * completes); the middle shows "Round N of M"; the body shows the current exercise + its per-round
 * target (reps, or a timed hold like 60s) + how-to. "Done" advances to the next exercise, wrapping
 * to the next round. Captures "N/M rounds" to the step note. Straight sets stay as separate reps
 * steps (their own sets ring) — this is only for coach-chosen circuits.
 */
export function StepCircuit({
  rounds,
  exercises,
  setNote,
}: {
  rounds: number;
  exercises: CircuitExercise[];
  setNote: (s: string) => void;
}) {
  const [round, setRound] = useState(0); // completed rounds
  const [pos, setPos] = useState(0); // exercise index within the current round
  const complete = round >= rounds;
  const ex = exercises[Math.min(pos, exercises.length - 1)];
  const lastOfRound = pos >= exercises.length - 1;
  const next = complete
    ? undefined
    : lastOfRound
      ? round + 1 < rounds
        ? exercises[0]
        : undefined
      : exercises[pos + 1];

  function done() {
    if (complete) return;
    if (pos + 1 < exercises.length) {
      setPos(pos + 1);
    } else {
      const nextRound = round + 1;
      setRound(nextRound);
      setPos(0);
      setNote(`${nextRound}/${rounds} round${rounds === 1 ? '' : 's'}`);
    }
  }

  const target = ex
    ? [ex.reps != null ? `${ex.reps} reps` : ex.seconds ? `${ex.seconds}s hold` : '', ex.load]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <div style={wrap}>
      <div style={{ position: 'relative', width: 132, height: 132 }}>
        <svg width="132" height="132" viewBox="0 0 132 132" aria-hidden>
          {Array.from({ length: rounds }).map((_, i) => {
            const seg = 100 / rounds;
            const len = Math.max(2, seg - (rounds > 1 ? 4 : 0.5));
            return (
              <circle
                key={i}
                cx="66"
                cy="66"
                r="58"
                fill="none"
                pathLength={100}
                stroke={i < round ? FOREST : MUTED}
                strokeWidth={9}
                strokeLinecap="round"
                strokeDasharray={`${len} ${100 - len}`}
                strokeDashoffset={-(i * seg)}
                transform="rotate(-90 66 66)"
                style={{ transition: 'stroke 0.25s' }}
              />
            );
          })}
        </svg>
        <div style={ringCenter}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: FOREST }}>ROUND</div>
          <div style={{ fontSize: 34, fontWeight: 900, lineHeight: 1 }}>
            {Math.min(round + 1, rounds)}
            <span style={{ fontSize: 15, fontWeight: 700, opacity: 0.45 }}>/{rounds}</span>
          </div>
        </div>
      </div>

      {!complete && ex && (
        <>
          <div style={{ fontSize: 20, fontWeight: 800, textAlign: 'center' }}>{ex.name}</div>
          {target && <div className="prog-sub">{target}</div>}
          {ex.detail && (
            <div className="prog-sub" style={{ textAlign: 'center', maxWidth: 320 }}>
              {ex.detail}
            </div>
          )}
          {ex.video_query && (
            <a href={ytSearch(ex.video_query)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13 }}>
              ▶ how-to: {ex.video_query}
            </a>
          )}
        </>
      )}

      <button style={{ ...btn, ...(complete ? btnDone : null) }} onClick={done} disabled={complete}>
        {complete ? '✓ Circuit done' : next ? `Done → ${next.name}` : 'Done — finish circuit'}
      </button>
    </div>
  );
}

const wrap: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 };
const ringCenter: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 2,
};
const btn: CSSProperties = {
  padding: '13px 22px',
  borderRadius: 14,
  border: 'none',
  fontWeight: 800,
  fontSize: 15,
  color: '#fff',
  background: FOREST,
  cursor: 'pointer',
  minWidth: 190,
  maxWidth: 300,
};
const btnDone: CSSProperties = { background: 'rgba(0,0,0,0.12)', color: FOREST, cursor: 'default' };
