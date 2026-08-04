import { useState } from 'react';
import { KEPT_LINE, freeWriteDoneLine, freeWriteKeptLine, freeWriteProgress, timeLeftLabel } from '@cadence/shared';
import { playChime } from '../walkthrough/tools/chime.ts';
import { keepJournalEntry } from '../../lib/api.ts';
import { useWriteTimer } from './useWriteTimer.ts';

/**
 * A timed free-write in a **physical journal** (owner, 2026-08-04) — the words go in their
 * notebook and this screen is only the clock.
 *
 * Everything that makes the on-screen version work by watching what someone types is therefore
 * absent, and deliberately so: no text area, no keyboard, no idle nudge (not typing IS the mode),
 * no word count. What survives is the part that matters — a hairline that moves, time remaining on
 * tap, a chime at the end, and an entry in the shelf saying they wrote.
 *
 * The kept row carries **no body and is secret by nature**, exactly like an untimed paper entry:
 * we never held those words and must never imply we did.
 */
export function FreeWritePaper({
  minutes,
  prompt,
  onClose,
  onKept,
}: {
  minutes: number;
  prompt: string;
  onClose: () => void;
  onKept: () => void;
}) {
  const totalSec = minutes * 60;
  const [showTime, setShowTime] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [finished, setFinished] = useState(false);

  // The bell rings and stops there — it never saves for you (owner ruling, 2026-08-04). Someone
  // mid-paragraph in their notebook finishes the paragraph; Save is theirs to press.
  const timer = useWriteTimer(totalSec, !finished, () => {
    playChime();
    navigator.vibrate?.(18);
  });

  async function keep() {
    if (saving) return;
    setSaving(true);
    setFailed(false);
    try {
      await keepJournalEntry({ bank: 'free_write', prompt, body: '', secret: true, mode: 'paper' });
      setFinished(true);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  if (finished) {
    return (
      <div className="fw-screen">
        <div className="jw-kept">
          <div className="jw-kept-disc" aria-hidden>
            ✓
          </div>
          {/* The duration is claimed only if the clock actually ran out. Stopping early — a baby,
              the door, a change of mind — is an ordinary save that reports nothing. */}
          <div className="jw-kept-line">{timer.done ? freeWriteKeptLine(minutes) : KEPT_LINE}</div>
          <button className="jw-kept-btn" onClick={onKept}>
            Done
          </button>
        </div>
      </div>
    );
  }

  const left = Math.max(0, totalSec - timer.elapsedSec);

  return (
    <div className="fw-screen">
      <div className="jw-bar">
        <button className="jw-back" onClick={onClose} aria-label="Close">
          ‹
        </button>
        <div className="jw-date">On paper</div>
        <button className="jw-save" onClick={() => void keep()} disabled={saving}>
          {saving ? '…' : 'Save'}
        </button>
      </div>

      {/* The hairline IS the timer — no clock on screen unless asked for. */}
      <button
        className="fw-rail"
        onClick={() => {
          setShowTime(true);
          setTimeout(() => setShowTime(false), 3000);
        }}
        aria-label={timeLeftLabel(left)}
      >
        <span className="fw-rail-fill" style={{ width: `${freeWriteProgress(timer.elapsedSec, totalSec) * 100}%` }} />
      </button>
      {showTime && <div className="fw-time">{timeLeftLabel(left)}</div>}

      <div className="fw-paper-body">
        <div className="jw-prompt">
          <em>{prompt}</em>
        </div>
        <div className="fw-paper-note">Your notebook has the words — this just keeps the time.</div>
        {timer.done && <div className="fw-done">{freeWriteDoneLine(minutes)}</div>}
      </div>

      {failed && <div className="jw-failed">That didn&rsquo;t save. Try again?</div>}
    </div>
  );
}
