import { useEffect, useRef, useState } from 'react';
import { previewMeal, type MealKind, type MealPreview } from '../../lib/api.ts';
import { newRequestId } from '../../lib/api/kept-answers.ts';
import { clearReadInProgress, rememberRead, type ReadInProgress } from './readInProgress.ts';
import { MicButton } from '../../components/MicButton.tsx';
import { PhotoButton } from '../../components/PhotoButton.tsx';
import { downscalePhoto } from '../plan/occurrence/format.ts';
import { MealParseCard } from './MealParseCard.tsx';
import { CoachReadLine } from './CoachReadLine.tsx';
import { READING } from './coachReadCopy.ts';
import { failureWords, type FailureWords } from './failureWords.ts';
import { previousRows } from './previousRows.ts';
import { GrowingTextarea } from '../../components/GrowingTextarea.tsx';

/** Lines before the composer stops growing and scrolls — a whole meal, dictated, fits. */
const COMPOSER_MAX_ROWS = 10;
/** When the read came back with no rows at all: a read, not a failure, so no retry button. */
export const NOTHING_READ = "I couldn't pick anything out of that — try naming the foods.";
export const TRY_AGAIN = 'Try again';

/**
 * Log by chat (design 05c) — and by voice, because **they are one screen**. The mic never leaves
 * the composer; opening with `listening` is the whole of what "Voice" means here. There is no
 * second interface to learn and no mode to be stuck in.
 *
 * What comes back is the parse-and-confirm card, which carries the amounts rule: an amount they
 * said is kept, an amount they didn't is asked for. Nothing counts until they tap it.
 *
 * The thread keeps its newest line in view on its own: it is a scroller now (the sheet hosting
 * it takes the whole height, food-capture.css), so a long card or a second message would
 * otherwise land below the fold with the composer above it.
 *
 * A second message while a card is up is "not quite" (owner, 2026-11-02): it goes back with the
 * SAME words and the card's rows as a correction, and the card that comes back replaces this one.
 * It used to start a fresh read of the second message alone, so "it was two cups" read as a meal
 * of two cups of nothing. A read that fails says what happened and what to do (failureWords.ts).
 */
export function LogByChat({
  meal,
  date,
  listening = false,
  resume,
  mode = 'log',
  mealLabel,
  onAppend,
  onLogged,
  onBack,
  onPhoto,
}: {
  meal: MealKind;
  /** The meal's date. With it, a read in flight is remembered for a relaunch (readInProgress.ts). */
  date?: string;
  /** Opened from the Voice tile — the mic starts live. */
  listening?: boolean;
  /** The read the app was relaunched in the middle of: asked after under its remembered id on open. */
  resume?: ReadInProgress;
  /**
   * Draft mode (meal-logging rework, 1b): this door APPENDS into the open meal — the confirm
   * card's button reads "Add to {meal}" and `onAppend` carries the rows through verbatim.
   */
  mode?: 'log' | 'draft';
  mealLabel?: string;
  onAppend?: (preview: MealPreview) => Promise<boolean>;
  onLogged: (preview: MealPreview) => void;
  onBack: () => void;
  /**
   * A photo picked from the composer's camera (owner, 2026-11-01: photos in every chat). It goes
   * to the meal's photo read, with whatever is in the box as its caption — the words are evidence
   * the picture cannot give. Absent = no camera.
   */
  onPhoto?: (photo: string, caption: string) => void;
}) {
  const [text, setText] = useState('');
  const [said, setSaid] = useState<string | null>(null);
  /** What they said was wrong with the card, when the card is a re-read. */
  const [correction, setCorrection] = useState<string | null>(null);
  const [preview, setPreview] = useState<MealPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<FailureWords | null>(null);
  const thread = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [said, correction, busy, preview, fail]);

  /**
   * The read. With `pickUp`, the read the app was relaunched in the middle of: its words and
   * correction come from the record, and it is asked after under its remembered id
   * (readInProgress.ts), sent again only if the server never got it.
   */
  async function read(pickUp?: ReadInProgress) {
    const typed = text.trim();
    if ((!typed && !pickUp) || busy) return;
    // With a card up, the message is about the card: the same words go back with it.
    const correcting = pickUp
      ? pickUp.correction
      : preview && said
        ? { words: typed, previous: previousRows(preview.items) }
        : undefined;
    const forWords = pickUp ? pickUp.words : correcting ? said! : typed;
    const requestId = pickUp?.requestId ?? newRequestId();
    setBusy(true);
    setFail(null);
    setSaid(forWords);
    setCorrection(correcting?.words ?? null);
    // Remembered for a relaunch while it runs; forgotten once it settles.
    if (date)
      rememberRead({
        door: 'chat',
        kind: 'words',
        meal,
        date,
        words: forWords,
        correction: correcting,
        requestId,
        listening,
      });
    try {
      const p = await previewMeal(forWords, meal, correcting, { requestId, resume: !!pickUp });
      if (!p.items.length) {
        setFail({ line: NOTHING_READ, retry: false });
        return;
      }
      setPreview(p);
      setText('');
    } catch (e) {
      setFail(failureWords(e, 'read'));
    } finally {
      setBusy(false);
      clearReadInProgress();
    }
  }

  // Relaunched mid-read: pick it up, once, on open. Leaving the door forgets any read in flight.
  useEffect(() => {
    if (resume) void read(resume);
    return () => clearReadInProgress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fc">
      <div className="fc-head">
        <button type="button" className="fd-back" aria-label="Back" onClick={onBack}>
          ‹
        </button>
        <h2>{mode === 'draft' ? `Add to ${mealLabel ?? meal}` : 'Log by chat'}</h2>
        <span className="fc-slot">{meal}</span>
      </div>

      <div className="fc-thread" ref={thread}>
        {said && <div className="fc-said">{said}</div>}
        {correction && <div className="fc-said">{correction}</div>}
        {busy && (
          <div className="fc-heard" role="status">
            {READING}
          </div>
        )}
        {/* Who read it, and her work as it happened — the same line the photo door shows. */}
        {preview && !busy && <CoachReadLine coach={preview.coach} corrected={!!correction} />}
        {preview && (
          <MealParseCard
            preview={preview}
            initialMeal={meal}
            mode={mode}
            mealLabel={mealLabel}
            onAppend={onAppend}
            onLogged={() => onLogged(preview)}
            onCancel={() => setPreview(null)}
          />
        )}
        {fail && (
          <div className="food-fail" role="alert">
            <span>{fail.line}</span>
            {fail.retry && (
              <button type="button" disabled={busy} onClick={() => void read()}>
                {TRY_AGAIN}
              </button>
            )}
          </div>
        )}
      </div>

      {/* The composer is always here, mic included — that is what makes voice and chat one screen. */}
      <div className="fc-compose">
        <GrowingTextarea
          value={text}
          onChange={setText}
          disabled={busy}
          maxRows={COMPOSER_MAX_ROWS}
          ariaLabel="What did you have?"
          placeholder={
            preview ? "Not quite? Say what's off, or just the amount…" : 'What did you have? The whole meal is fine.'
          }
          onSubmit={() => void read()}
        />
        {/* The buttons sit on their own row under the field so the words keep the full width. */}
        <div className="fc-compose-tools">
          <MicButton value={text} onChange={setText} disabled={busy} autoStart={listening} />
          {onPhoto && (
            <PhotoButton
              disabled={busy}
              onPick={([file]) => void downscalePhoto(file!).then((photo) => onPhoto(photo, text.trim()))}
            />
          )}
          {text.trim() && (
            <button
              type="button"
              className="fc-send"
              disabled={busy}
              aria-label="Read that"
              onClick={() => void read()}
            >
              ›
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
