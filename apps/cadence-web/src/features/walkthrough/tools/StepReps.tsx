import { useState, type CSSProperties } from 'react';
import type { StepLog } from '../state.ts';
import { TONE, RING_C } from './tone.ts';

const GAP = 10;
type RepsLog = Extract<StepLog, { kind: 'reps' }>;

/**
 * Reps tool (walkthrough v2, design A). The ring is the sets; the centre count is editable via the
 * flanking − / + dial; the delta line doubles as the reset-to-target control; the ONE tone button
 * logs the number it names ("Log set 3 · 12 reps"). A fresh set opens at what you logged last (set 1
 * at target), so the common case is repeating reality. Tap a logged chip to re-open + edit it. Every
 * write goes through `onLog` — moving between steps logs nothing.
 */
export function StepReps({
  sets,
  reps: target,
  load,
  log,
  onLog,
}: {
  sets: number;
  reps?: number;
  load?: string;
  log?: RepsLog;
  onLog: (l: RepsLog) => void;
}) {
  const logged = log?.sets ?? [];
  const [editing, setEditing] = useState<number | null>(null);
  const [dial, setDial] = useState<number | null>(null);

  const fallback = target ?? 10;
  const carry = editing != null ? (logged[editing] ?? fallback) : logged.length ? logged[logged.length - 1]! : fallback;
  const reps = dial == null ? carry : dial;
  const setNum = editing != null ? editing + 1 : Math.min(logged.length + 1, sets);
  const full = logged.length >= sets && editing == null;

  const bump = (d: number) => setDial(Math.max(0, Math.min(99, reps + d)));
  function commit() {
    if (editing != null) {
      const next = logged.slice();
      next[editing] = reps;
      onLog({ kind: 'reps', sets: next, target, load });
      setEditing(null);
    } else if (logged.length < sets) {
      onLog({ kind: 'reps', sets: [...logged, reps], target, load });
    }
    setDial(null);
  }

  const delta = target != null ? reps - target : 0;
  const deltaLabel =
    delta === 0
      ? 'On target'
      : delta > 0
        ? `+${delta} over target · reset to ${target}`
        : `${delta} under target · reset to ${target}`;

  const seg = RING_C / sets;
  const arc = Math.max(2, seg - GAP);

  return (
    <div style={card}>
      <div
        style={{ position: 'relative', height: 158, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <svg width="158" height="158" viewBox="0 0 128 128" style={{ position: 'absolute' }} aria-hidden>
          {Array.from({ length: sets }).map((_, i) => (
            <circle
              key={i}
              cx="64"
              cy="64"
              r="54"
              fill="none"
              strokeWidth={13}
              strokeLinecap="round"
              stroke={i < logged.length ? TONE.deep : TONE.track}
              strokeDasharray={`${arc} ${RING_C - arc}`}
              strokeDashoffset={-(i * seg)}
              transform="rotate(-90 64 64)"
            />
          ))}
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
          <div style={eyebrow}>
            Set {setNum} of {sets}
          </div>
          <div
            style={{
              fontFamily: 'var(--display), serif',
              fontWeight: 600,
              fontSize: 46,
              lineHeight: 1.05,
              color: TONE.ink,
            }}
          >
            {reps}
          </div>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 800,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: TONE.sub,
            }}
          >
            reps done
          </div>
        </div>
        <button onClick={() => bump(-1)} disabled={full} style={{ ...dialBtn, left: 6 }} aria-label="one fewer rep">
          −
        </button>
        <button onClick={() => bump(1)} disabled={full} style={{ ...dialBtn, right: 6 }} aria-label="one more rep">
          +
        </button>
      </div>

      {target != null && !full && (
        <div
          onClick={() => setDial(target)}
          style={{
            textAlign: 'center',
            fontSize: 11.5,
            fontWeight: 800,
            color: delta === 0 ? TONE.green : TONE.off,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {deltaLabel}
        </div>
      )}

      <button onClick={commit} disabled={full} style={{ ...logBtn, opacity: full ? 0.62 : 1 }}>
        {full
          ? `Sets logged · ${sets} of ${sets}`
          : editing != null
            ? `Save set ${editing + 1} · ${reps} reps`
            : `Log set ${setNum} · ${reps} reps`}
      </button>

      <div style={{ display: 'flex', gap: 6, borderTop: '1px solid oklch(93% 0.012 85)', paddingTop: 13 }}>
        {Array.from({ length: sets }).map((_, i) => {
          const done = i < logged.length;
          const isCurrent = editing != null ? i === editing : i === logged.length;
          const off = done && target != null && logged[i] !== target;
          return (
            <div
              key={i}
              onClick={
                done
                  ? () => {
                      setEditing(i);
                      setDial(logged[i]!);
                    }
                  : undefined
              }
              style={{
                flex: 1,
                textAlign: 'center',
                borderRadius: 12,
                padding: '8px 0',
                background: done ? 'oklch(97% 0.02 74)' : 'white',
                border: `1.5px solid ${done ? 'oklch(90% 0.05 70)' : isCurrent ? TONE.fillA : 'oklch(93% 0.012 85)'}`,
                cursor: done ? 'pointer' : 'default',
              }}
            >
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 900,
                  lineHeight: 1.1,
                  color: done ? (off ? TONE.off : 'oklch(40% 0.06 62)') : 'oklch(78% 0.015 85)',
                }}
              >
                {done ? logged[i] : isCurrent ? '·' : '—'}
              </div>
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 900,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: done ? 'oklch(52% 0.04 62)' : 'oklch(66% 0.015 85)',
                }}
              >
                Set {i + 1}
              </div>
            </div>
          );
        })}
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
const eyebrow: CSSProperties = {
  fontSize: 10,
  fontWeight: 900,
  letterSpacing: '0.09em',
  textTransform: 'uppercase',
  color: TONE.sub,
};
const dialBtn: CSSProperties = {
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  width: 50,
  height: 44,
  border: 'none',
  borderRadius: 999,
  background: 'linear-gradient(180deg,#fff 0%,oklch(96% 0.01 85) 46%)',
  boxShadow: '0 4px 0 oklch(88% 0.02 85), 0 0 0 1px oklch(92% 0.015 85)',
  fontSize: 24,
  fontWeight: 800,
  color: 'oklch(40% 0.02 150)',
  cursor: 'pointer',
  padding: 0,
  lineHeight: 1,
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
