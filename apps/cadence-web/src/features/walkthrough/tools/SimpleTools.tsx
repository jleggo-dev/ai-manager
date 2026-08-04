import { useState, type CSSProperties } from 'react';
import { freeWriteDoneLine, freeWriteProgress, timeLeftLabel } from '@cadence/shared';
import { TONE } from './tone.ts';
import { MicButton } from '../../../components/MicButton.tsx';
import { useWriteTimer } from '../../journal/useWriteTimer.ts';
import { playChime } from './chime.ts';

/** checkoff / read — one tone button that logs "done" (the browse/do/commit "do"). */
export function StepCheckoff({ label, done, onDone }: { label?: string; done: boolean; onDone: () => void }) {
  return (
    <div style={card}>
      {label && <div style={{ fontSize: 30, fontWeight: 800, color: TONE.deep, textAlign: 'center' }}>{label}</div>}
      <button style={{ ...logBtn, opacity: done ? 0.62 : 1 }} onClick={onDone} disabled={done}>
        {done ? '✓ Logged' : 'Log this done'}
      </button>
    </div>
  );
}

/**
 * journal — write or speak an entry inside a session. The words are kept in the journal store on
 * Finish (the walkthrough's commit rule), so the key belongs here too: a session is an ordinary
 * place to write something you'd rather the coach didn't read.
 */
export function StepJournal({
  prompt,
  note,
  secret,
  minutes,
  onLog,
  onSecret,
}: {
  prompt: string;
  note: string;
  secret: boolean;
  /** Set when the coach asked for a timed free-write — the same quiet clock the writing page runs. */
  minutes?: number;
  onLog: (n: string) => void;
  onSecret: (s: boolean) => void;
}) {
  const totalSec = (minutes ?? 0) * 60;
  const [showTime, setShowTime] = useState(false);
  // The bell chimes and stops there. It cannot save even if it wanted to — a session commits on
  // Finish — which is the same rule the writing page follows for its own reasons.
  const timer = useWriteTimer(totalSec, !!minutes, () => {
    playChime();
    navigator.vibrate?.(18);
  });

  return (
    <div style={card}>
      {minutes ? (
        <>
          <button
            className="fw-rail"
            onClick={() => {
              setShowTime(true);
              setTimeout(() => setShowTime(false), 3000);
            }}
            aria-label={timeLeftLabel(totalSec - timer.elapsedSec)}
          >
            <span
              className="fw-rail-fill"
              style={{ width: `${freeWriteProgress(timer.elapsedSec, totalSec) * 100}%` }}
            />
          </button>
          {showTime && <div className="fw-time">{timeLeftLabel(totalSec - timer.elapsedSec)}</div>}
          {timer.done && <div className="fw-done">{freeWriteDoneLine(minutes)}</div>}
        </>
      ) : null}
      <div className="logbox-label">{prompt}</div>
      <div className="steer-row">
        <textarea
          className="logbox-in"
          rows={3}
          value={note}
          onChange={(e) => {
            onLog(e.target.value);
            timer.poke();
          }}
          placeholder="Write a few words…"
        />
        <MicButton value={note} onChange={onLog} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <button className={`jw-key ${secret ? 'on' : ''}`} onClick={() => onSecret(!secret)} aria-pressed={secret}>
          ⚿ {secret ? 'secret' : 'mark secret'}
        </button>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'oklch(55% 0.02 150)' }}>
          {secret ? "I won't read this one." : 'Kept in your journal.'}
        </span>
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
