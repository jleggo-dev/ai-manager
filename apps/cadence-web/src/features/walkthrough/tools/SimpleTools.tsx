import { type CSSProperties } from 'react';
import { TONE } from './tone.ts';
import { MicButton } from '../../../components/MicButton.tsx';

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
  onLog,
  onSecret,
}: {
  prompt: string;
  note: string;
  secret: boolean;
  onLog: (n: string) => void;
  onSecret: (s: boolean) => void;
}) {
  return (
    <div style={card}>
      <div className="logbox-label">{prompt}</div>
      <div className="steer-row">
        <textarea
          className="logbox-in"
          rows={3}
          value={note}
          onChange={(e) => onLog(e.target.value)}
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
