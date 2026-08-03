import { useEffect, useRef, useState } from 'react';
import {
  JOURNAL_BANKS,
  JOURNAL_DISCLOSURE,
  SHARE_FRAMING,
  isShareableGratitude,
  todaysPhrasing,
  type JournalBank,
} from '@cadence/shared';
import { keepJournalEntry } from '../../lib/api.ts';
import { MicButton } from '../../components/MicButton.tsx';

/**
 * The writing page (Journal v2, settled): full-screen, words directly on the cream — no card, no
 * box. The question arrives via the quiet "Start from a question" pill and, once chosen, stands
 * above the entry (kept with it — the question is half the meaning when rereading; × removes it).
 * The key means secret: default off, one tap, and it locks the entry against the coach, not you.
 *
 * Modes: type · speak · paper. Speak reuses the dictation seam (MicButton) with the transcript
 * landing editable in the same page — "I keep the words, not the recording." Paper is a shelf
 * row for an entry written in a physical journal: no body, secret by nature (the server forces
 * it). Back with a draft keeps it silently — a journal that might lose words is dead on arrival.
 *
 * Rule 1 lives here too: OS autocorrect stays on (standard keyboard behaviour), but nothing we
 * write ever rewrites their words.
 */
export function JournalWrite({ onClose, onKept }: { onClose: () => void; onKept: () => void }) {
  const [text, setText] = useState('');
  const [bank, setBank] = useState<JournalBank | null>(null);
  const [secret, setSecret] = useState(false);
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // The disclosure, said once ever — the coach's voice, before the first word is written.
  const [disclose] = useState(() => {
    try {
      return localStorage.getItem('cadence.journalDisclosed') !== '1';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    if (disclose) {
      try {
        localStorage.setItem('cadence.journalDisclosed', '1');
      } catch {
        /* private browsing — it will simply say it again */
      }
    }
  }, [disclose]);

  const today = new Date().toISOString().slice(0, 10);
  const prompt = bank ? todaysPhrasing(bank, today) : null;

  async function keep(mode: 'typed' | 'paper') {
    if (saving) return;
    setSaving(true);
    setFailed(false);
    try {
      await keepJournalEntry({
        bank: bank?.id ?? null,
        prompt,
        body: mode === 'paper' ? '' : text,
        secret,
        mode,
      });
      // The share moment: gratitude entries only, by kept prompt, never on secrets, OS-native
      // only — and never re-prompted. Dismissing the sheet is a complete answer.
      if (mode === 'typed' && isShareableGratitude(bank?.id, secret) && navigator.share) {
        await navigator.share({ text }).catch(() => undefined);
      }
      onKept();
    } catch {
      setFailed(true); // the draft stays right here — nothing is lost until you leave this screen
      setSaving(false);
    }
  }

  return (
    <div className="jw" role="dialog" aria-label="Write in your journal">
      <div className="jw-bar">
        <button className="jw-back" onClick={onClose} aria-label="Back">
          ‹
        </button>
        <span className="jw-date">
          {new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()}
        </span>
        <span className="jw-tools">
          <button
            className={`jw-key ${secret ? 'on' : ''}`}
            onClick={() => setSecret((s) => !s)}
            aria-pressed={secret}
            aria-label={secret ? 'Secret — the coach will not see this' : 'Mark secret'}
            title={secret ? 'Secret — locked against the coach, not you' : 'Mark secret'}
          >
            ⚿ {secret ? 'secret' : ''}
          </button>
          <MicButton value={text} onChange={setText} />
          <button className="jw-save" disabled={!text.trim() || saving} onClick={() => void keep('typed')}>
            Save
          </button>
        </span>
      </div>

      {disclose && <div className="jw-disclose">{JOURNAL_DISCLOSURE}</div>}

      {prompt && (
        <div className="jw-prompt">
          <em>{prompt}</em>
          <button aria-label="Remove the question" onClick={() => setBank(null)}>
            ×
          </button>
        </div>
      )}

      <textarea
        ref={areaRef}
        className="jw-page"
        placeholder="Write anything…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
      />

      {failed && (
        <div className="jw-failed">
          That didn&apos;t save. Your words are still here — try again when you&apos;re ready.
        </div>
      )}

      {isShareableGratitude(bank?.id, secret) && text.trim() && <div className="jw-shareline">{SHARE_FRAMING}</div>}

      <div className="jw-dock">
        {!text.trim() && !bank && (
          <button className="jw-pill" onClick={() => setPicker(true)}>
            Start from a question
          </button>
        )}
        <button className="jw-paper" onClick={() => void keep('paper')} disabled={saving}>
          ✎ I wrote on paper today
        </button>
      </div>

      {picker && (
        <>
          <div className="sheet-scrim" onClick={() => setPicker(false)} aria-hidden />
          <div className="sheet jw-picker" role="dialog" aria-label="A question to start from">
            <div className="sheet-grab" aria-hidden />
            <b className="jw-picker-head">A question to start from</b>
            {JOURNAL_BANKS.map((b) => (
              <button
                key={b.id}
                className="jw-bank"
                onClick={() => {
                  setBank(b);
                  setPicker(false);
                  areaRef.current?.focus();
                }}
              >
                <span>{b.label.toUpperCase()}</span>
                <em>{todaysPhrasing(b, today)}</em>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
