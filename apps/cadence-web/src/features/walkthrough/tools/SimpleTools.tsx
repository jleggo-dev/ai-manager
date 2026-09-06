import { useState, type CSSProperties } from 'react';
import { freeWriteDoneLine, freeWriteProgress, timeLeftLabel } from '@cadence/shared';
import type { StepLog } from '../state.ts';
import { TONE } from './tone.ts';
import { MicButton } from '../../../components/MicButton.tsx';
import { useWriteTimer } from '../../journal/useWriteTimer.ts';
import { playChime } from './chime.ts';

type DoneLog = Extract<StepLog, { kind: 'done' }>;

/**
 * checkoff / read — one deliberate tone button that logs "done" (the browse/do/commit "do"). The
 * note field is optional and free — "a distance, an errand" rarely needs one, so it never blocks
 * the single tap; whatever's typed rides along in the same log write rather than needing a second
 * action. With a `prompt` it is a QUESTION — "How is the knee?" — and the note is the answer: the
 * body-side check-in, a few free words about a part, never a mood vocabulary.
 */
export function StepCheckoff({
  label,
  prompt,
  log,
  onLog,
}: {
  label?: string;
  prompt?: string;
  log?: DoneLog;
  onLog: (l: DoneLog) => void;
}) {
  const [note, setNote] = useState('');
  const done = !!log;
  return (
    <div style={card}>
      {label && <div style={{ fontSize: 30, fontWeight: 800, color: TONE.deep, textAlign: 'center' }}>{label}</div>}
      {prompt && <div style={promptStyle}>{prompt}</div>}
      {done ? (
        log.note && <div style={savedNote}>{log.note}</div>
      ) : (
        <input
          style={noteInput}
          placeholder={prompt ? 'a few words (optional)' : 'anything to add? (optional)'}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
        />
      )}
      <button
        style={{ ...logBtn, opacity: done ? 0.62 : 1 }}
        onClick={() => onLog({ kind: 'done', ...(note.trim() ? { note: note.trim() } : {}) })}
        disabled={done}
      >
        {done ? '✓ Logged' : prompt ? 'Log it' : 'Log this done'}
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
const noteInput: CSSProperties = {
  border: '1px solid oklch(90% 0.015 95)',
  borderRadius: 12,
  padding: '12px 13px',
  fontSize: 13,
  fontFamily: 'inherit',
  color: 'oklch(30% 0.02 150)',
  outline: 'none',
};
const promptStyle: CSSProperties = {
  fontFamily: 'var(--display), serif',
  fontWeight: 600,
  fontSize: 19,
  lineHeight: 1.3,
  color: 'oklch(28% 0.02 150)',
};
const savedNote: CSSProperties = {
  fontSize: 12.5,
  lineHeight: 1.45,
  color: 'oklch(45% 0.02 150)',
  background: 'oklch(97% 0.012 85)',
  border: '1px solid oklch(91% 0.015 85)',
  borderRadius: 12,
  padding: '10px 12px',
};
