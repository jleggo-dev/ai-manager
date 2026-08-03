import { useState, type CSSProperties } from 'react';
import {
  FEELING_FAMILIES,
  FEELING_FOOTER,
  FEELING_ROOMS,
  allFeelingWords,
  familyExamples,
  feelingAcknowledgement,
  findFamily,
  type FeelingFamily,
  type FeelingRoom,
} from '@cadence/shared';
import type { StepLog } from '../state.ts';
import { TONE } from './tone.ts';

type FeelingLog = Extract<StepLog, { kind: 'feeling_log' }>;

/**
 * Chrome C — capture, proven with `feeling_log` (REQ9 §4.4). The mind side's weigh-in.
 *
 * **Two taps deep on purpose.** Six family tiles are one glance; thirty-six words are a reading
 * task. The tiles carry three example words each, so the second step *confirms* rather than
 * discovers — and the family word is itself selectable ("just: wired"), so nobody is ever forced
 * to be more precise than they actually are.
 *
 * **Intensity is spatial, never a severity scale.** "In the background / here / filling the room"
 * is stored 1–3 for correlation maths, and the numbers never render anywhere in the product. A
 * 1–10 slider would be exactly the wrong register.
 *
 * **And then nothing.** One acknowledgment in the coach's voice, and no surface — no chart, no
 * history, no streak. There is deliberately nowhere in the app to go and look at your feelings;
 * patterns appear only in conversation, and only when there is something coachable. That single
 * sentence is the entire visible reward, which is what keeps this a note rather than a dashboard.
 */
export function StepFeelingLog({ onLog, onDone }: { onLog: (l: FeelingLog) => void; onDone: () => void }) {
  const [family, setFamily] = useState<FeelingFamily | null>(null);
  const [word, setWord] = useState<string | null>(null);
  const [room, setRoom] = useState<FeelingRoom | null>(null);
  const [note, setNote] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState('');
  const [saved, setSaved] = useState<{ word: string; room: FeelingRoom } | null>(null);

  function save() {
    if (!word || !room) return;
    setSaved({ word, room });
    onLog({
      kind: 'feeling_log',
      word,
      family: findFamily(family?.id ?? '')?.id ?? null,
      room,
      note: note.trim() || undefined,
    });
  }

  if (saved) {
    return (
      <div style={card}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '8px 2px' }}>
          <div style={ackStyle}>{feelingAcknowledgement(saved.word, saved.room)}</div>
          <div style={footerStyle}>{FEELING_FOOTER}</div>
        </div>
        <button style={primaryBtn} onClick={onDone}>
          Close
        </button>
      </div>
    );
  }

  /* ── Step three · how much room is it taking ── */
  if (word) {
    return (
      <div style={card}>
        <button style={chosenChip} onClick={() => setWord(null)}>
          <b>{word}</b>
          <span>tap to change</span>
        </button>

        <div style={capsLabel}>How much room is it taking?</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {FEELING_ROOMS.map((r) => (
            <button
              key={r.value}
              style={{ ...roomRow, ...(room === r.value ? roomOn : null) }}
              onClick={() => setRoom(r.value)}
            >
              {/* The dot grows with the amount of room — the scale is a size, never a number. */}
              <span style={{ ...roomDot, width: 8 * r.value, height: 8 * r.value }} aria-hidden />
              <span>{r.label}</span>
            </button>
          ))}
        </div>

        <input
          style={noteInput}
          placeholder="anything to add? (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
        />
        <button style={{ ...primaryBtn, opacity: room ? 1 : 0.45 }} onClick={save} disabled={!room}>
          Save
        </button>
      </div>
    );
  }

  /* ── The full list — the one place typing is allowed, because it is search, not disclosure ── */
  if (showAll) {
    const words = allFeelingWords().filter((w) => w.includes(filter.trim().toLowerCase()));
    return (
      <div style={card}>
        <div style={headRow}>
          <button style={backBtn} onClick={() => setShowAll(false)} aria-label="Back">
            ‹
          </button>
          <div style={titleStyle}>Every word</div>
        </div>
        <input style={noteInput} placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
          {words.map((w) => (
            <button key={w} style={wordChip} onClick={() => setWord(w)}>
              {w}
            </button>
          ))}
        </div>
      </div>
    );
  }

  /* ── Step two · the narrowing, and the way out of it ── */
  if (family) {
    return (
      <div style={card}>
        <div style={headRow}>
          <button style={backBtn} onClick={() => setFamily(null)} aria-label="Back">
            ‹
          </button>
          <div>
            <div style={titleStyle}>{family.name} — which one?</div>
            <div style={metaStyle}>PICK THE CLOSEST · OR STAY WITH {family.name.toUpperCase()}</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {family.words.map((w) => (
            <button key={w} style={wordChip} onClick={() => setWord(w)}>
              {w}
            </button>
          ))}
          {/* Someone who only knows "wired" is never forced to be more precise than they are. */}
          <button style={{ ...wordChip, ...justChip }} onClick={() => setWord(family.name.toLowerCase())}>
            just: {family.name.toLowerCase()}
          </button>
        </div>
        <button style={textBtn} onClick={() => setShowAll(true)}>
          Look for a different word
        </button>
      </div>
    );
  }

  /* ── Step one · six families, examples visible ── */
  return (
    <div style={card}>
      <div>
        <div style={titleStyle}>How are you doing?</div>
        <div style={metaStyle}>20 SECONDS · NOTHING TO GET RIGHT</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {FEELING_FAMILIES.map((f) => (
          <button key={f.id} style={familyRow} onClick={() => setFamily(f)}>
            <b>{f.name}</b>
            <span>{familyExamples(f).join(' · ')}</span>
          </button>
        ))}
      </div>
      <button style={textBtn} onClick={() => setShowAll(true)}>
        None of these — show every word
      </button>
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
  gap: 13,
};
const headRow: CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 10 };
const backBtn: CSSProperties = {
  width: 30,
  height: 30,
  flex: 'none',
  borderRadius: '50%',
  border: '1px solid oklch(90% 0.015 95)',
  background: 'white',
  fontSize: 17,
  color: 'oklch(45% 0.02 150)',
  cursor: 'pointer',
  lineHeight: 1,
};
const titleStyle: CSSProperties = {
  fontFamily: 'var(--display), serif',
  fontWeight: 600,
  fontSize: 19,
  color: 'oklch(28% 0.02 150)',
};
const metaStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.04em',
  color: 'oklch(56% 0.02 120)',
  marginTop: 3,
};
const capsLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'oklch(52% 0.02 120)',
};
const familyRow: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 2,
  width: '100%',
  textAlign: 'left',
  background: 'white',
  border: '1px solid oklch(90% 0.02 85)',
  borderRadius: 14,
  padding: '12px 14px',
  cursor: 'pointer',
};
const wordChip: CSSProperties = {
  padding: '14px 16px',
  borderRadius: 999,
  border: '1.5px solid oklch(90% 0.015 95)',
  background: 'white',
  fontSize: 16,
  fontWeight: 800,
  color: 'oklch(30% 0.02 150)',
  cursor: 'pointer',
};
const justChip: CSSProperties = { borderStyle: 'dashed', color: 'oklch(45% 0.02 150)' };
const chosenChip: CSSProperties = {
  alignSelf: 'flex-start',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 1,
  padding: '10px 16px',
  borderRadius: 999,
  border: `1.5px solid ${TONE.fillA}`,
  background: 'oklch(95% 0.05 60)',
  cursor: 'pointer',
};
const roomRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  textAlign: 'left',
  background: 'white',
  border: '1px solid oklch(90% 0.02 85)',
  borderRadius: 14,
  padding: '14px 16px',
  fontSize: 14.5,
  fontWeight: 700,
  color: 'oklch(32% 0.02 150)',
  cursor: 'pointer',
  minHeight: 60,
};
const roomOn: CSSProperties = { border: `1.5px solid ${TONE.fillA}`, background: 'oklch(96% 0.035 62)' };
const roomDot: CSSProperties = { borderRadius: '50%', background: TONE.fillA, flex: 'none' };
const noteInput: CSSProperties = {
  border: '1px solid oklch(90% 0.015 95)',
  borderRadius: 12,
  padding: '12px 13px',
  fontSize: 13,
  fontFamily: 'inherit',
  color: 'oklch(30% 0.02 150)',
  outline: 'none',
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
const textBtn: CSSProperties = {
  border: 'none',
  background: 'transparent',
  padding: 4,
  fontSize: 13,
  fontWeight: 800,
  color: 'oklch(52% 0.02 150)',
  cursor: 'pointer',
  textAlign: 'center',
};
const ackStyle: CSSProperties = {
  fontFamily: 'var(--display), serif',
  fontWeight: 600,
  fontSize: 19,
  lineHeight: 1.3,
  color: 'oklch(28% 0.02 150)',
};
const footerStyle: CSSProperties = { fontSize: 13, fontWeight: 700, color: 'oklch(52% 0.02 150)' };
