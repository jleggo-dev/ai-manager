import { useEffect, useRef, useState } from 'react';
import {
  FREE_WRITE_NUDGE,
  JOURNAL_BANKS,
  JOURNAL_DISCLOSURE,
  SHARE_FRAMING,
  freeWriteDoneLine,
  freeWriteProgress,
  isShareableGratitude,
  shouldNudge,
  timeLeftLabel,
  todaysPhrasing,
  type JournalBank,
} from '@cadence/shared';
import { keepJournalEntry } from '../../lib/api.ts';
import { MicButton } from '../../components/MicButton.tsx';
import { playChime } from '../walkthrough/tools/chime.ts';
import { FreeWriteStart, type FreeWriteStartChoice } from './FreeWriteStart.tsx';
import { FreeWritePaper } from './FreeWritePaper.tsx';
import { useWriteTimer } from './useWriteTimer.ts';

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
export function JournalWrite({
  onClose,
  onKept,
  openWith,
}: {
  onClose: () => void;
  onKept: () => void;
  /** The question this page opens on when the coach chose one — a bank it named, or a sentence it
   *  wrote for this person. Absent when the page is opened cold, which is a real state: no
   *  question, the picker one tap away. Whatever the coach sent, the reader can still change it.
   *
   *  `minutes` set means the coach asked for a TIMED free-write: the page opens on the start sheet
   *  rather than a blank box, because the clock has to begin on a deliberate press. */
  openWith?: {
    bank: JournalBank | null;
    prompt: string | null;
    minutes?: number;
    topics?: readonly { label: string; prompt: string }[];
  };
}) {
  const [text, setText] = useState('');
  const [bank, setBank] = useState<JournalBank | null>(openWith?.bank ?? null);
  // A coach-written question, held apart from the banks because it has no phrasing pool to rotate.
  // Picking from the picker clears it — the reader's choice replaces the coach's, never stacks.
  const [written, setWritten] = useState<string | null>(openWith?.prompt ?? null);
  const [secret, setSecret] = useState(false);
  const [picker, setPicker] = useState(false);
  // A coach-issued duration opens the start sheet immediately — the clock must begin on a press.
  const [freeStart, setFreeStart] = useState(() => openWith?.minutes !== undefined);
  const [timed, setTimed] = useState<FreeWriteStartChoice | null>(null);
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
  const prompt = written ?? (bank ? todaysPhrasing(bank, today) : null);

  const totalSec = (timed?.minutes ?? 0) * 60;
  // The bell chimes and stops there — it does NOT save and does NOT take the screen (owner ruling,
  // 2026-08-04). Someone mid-sentence finishes the sentence; Save is theirs to press, whenever.
  const timer = useWriteTimer(totalSec, timed?.surface === 'typed', () => {
    playChime();
    navigator.vibrate?.(18);
  });
  const [showTime, setShowTime] = useState(false);

  /**
   * One entry, one save — including for a timed write. The bell never saves, so there is no path
   * where continuing past it produces a second entry containing the first one's text (the store
   * has an insert but no update). Pressing Save is the only way words are kept, at any point.
   */
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

  // A timed write on paper is a different screen: no text area, no keyboard, no nudge — the words
  // are in a notebook and this app is only the clock.
  if (timed?.surface === 'paper') {
    return <FreeWritePaper minutes={timed.minutes} prompt={timed.prompt} onClose={onClose} onKept={onKept} />;
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

      {/* The hairline IS the timer — no clock on screen unless tapped for. */}
      {timed && (
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
        </>
      )}

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
        onChange={(e) => {
          setText(e.target.value);
          timer.poke(); // resets the idle window; the nudge fades on the next keystroke
        }}
        autoFocus
      />

      {/* An offer, never enforcement — it touches no words and disappears the moment you type.
          Gone once the bell has rung: "keep going" would be arguing with the clock. */}
      {timed && !timer.done && shouldNudge('typed', timer.idleMs) && <div className="fw-nudge">{FREE_WRITE_NUDGE}</div>}

      {/* The bell, said quietly and left there. No countdown to zero, no pressure to stop. */}
      {timed && timer.done && <div className="fw-done">{freeWriteDoneLine(timed.minutes)}</div>}

      {failed && (
        <div className="jw-failed">
          That didn&apos;t save. Your words are still here — try again when you&apos;re ready.
        </div>
      )}

      {isShareableGratitude(bank?.id, secret) && text.trim() && <div className="jw-shareline">{SHARE_FRAMING}</div>}

      {/* The dock is gone mid-session: a running clock has already answered both of its questions.
          Offering "start from a question" over a chosen prompt, or "I wrote on paper today" while
          they are writing here right now, contradicts the session they are in. */}
      {!timed && (
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
      )}

      {freeStart && (
        <FreeWriteStart
          coachMinutes={openWith?.minutes}
          topics={openWith?.topics}
          onClose={() => setFreeStart(false)}
          onStart={(c) => {
            setFreeStart(false);
            setWritten(c.prompt);
            setBank(null);
            setTimed(c);
          }}
        />
      )}

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
                  setPicker(false);
                  // "There is no untimed path into a free-write" (Design §1b): the free-write row
                  // is the doorway to the clock, not a question you can take without one.
                  if (b.id === 'free_write') {
                    setFreeStart(true);
                    return;
                  }
                  setBank(b);
                  setWritten(null); // the reader's pick replaces the coach's question
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
