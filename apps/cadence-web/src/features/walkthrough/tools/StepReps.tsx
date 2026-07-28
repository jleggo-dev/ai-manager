import { useState, type CSSProperties } from 'react';

const FOREST = 'var(--forest, #3f7a52)';
const MUTED = 'rgba(0,0,0,0.10)';

/**
 * The **reps** tool (REQ8 slice 2 — sets/reps as first-class). A set-based exercise is done one set
 * at a time: the segmented ring is the SETS, filling as each lands, with "Set N of M" in the middle.
 * "Done set" ticks a segment; the last one completes the ring. It captures "N/M sets × reps @ load"
 * into the step note so the sets you actually did flow to the log (the adaptation signal) — doing
 * fewer than prescribed is honest data, not a failure. It does NOT auto-advance; the shell's Next
 * moves to the next exercise, so you control the rest between exercises.
 */
export function StepReps({
  sets,
  reps,
  load,
  setNote,
}: {
  sets: number;
  reps?: number;
  load?: string;
  setNote: (s: string) => void;
}) {
  const [done, setDone] = useState(0);
  const complete = done >= sets;
  const current = Math.min(done + 1, sets);

  function tick() {
    if (complete) return;
    const next = done + 1;
    setDone(next);
    const suffix = [reps != null ? `× ${reps}` : '', load ? `@ ${load}` : ''].filter(Boolean).join(' ');
    setNote(`${next}/${sets} set${sets === 1 ? '' : 's'}${suffix ? ` ${suffix}` : ''}`);
  }

  return (
    <div style={wrap}>
      <div style={{ position: 'relative', width: 132, height: 132 }}>
        <svg width="132" height="132" viewBox="0 0 132 132" aria-hidden>
          {Array.from({ length: sets }).map((_, i) => {
            const seg = 100 / sets;
            const len = Math.max(2, seg - (sets > 1 ? 4 : 0.5));
            return (
              <circle
                key={i}
                cx="66"
                cy="66"
                r="58"
                fill="none"
                pathLength={100}
                stroke={i < done ? FOREST : MUTED}
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
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', color: FOREST }}>SET</div>
          <div style={{ fontSize: 36, fontWeight: 900, lineHeight: 1 }}>
            {current}
            <span style={{ fontSize: 15, fontWeight: 700, opacity: 0.45 }}>/{sets}</span>
          </div>
        </div>
      </div>
      {(reps != null || load) && (
        <div className="prog-sub">{[reps != null ? `${reps} reps` : '', load].filter(Boolean).join(' · ')}</div>
      )}
      <button style={{ ...btn, ...(complete ? btnDone : null) }} onClick={tick} disabled={complete}>
        {complete ? '✓ All sets done' : done === sets - 1 ? 'Done — last set' : 'Done set'}
      </button>
    </div>
  );
}

const wrap: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 };
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
  padding: '13px 26px',
  borderRadius: 14,
  border: 'none',
  fontWeight: 800,
  fontSize: 15,
  color: '#fff',
  background: FOREST,
  cursor: 'pointer',
  minWidth: 190,
};
const btnDone: CSSProperties = { background: 'rgba(0,0,0,0.12)', color: FOREST, cursor: 'default' };
