import { useEffect, useRef, useState } from 'react';
import { previewMeal, type MealKind, type MealPreview } from '../../lib/api.ts';
import { MicButton } from '../../components/MicButton.tsx';
import { MealParseCard } from './MealParseCard.tsx';
import { GrowingTextarea } from '../../components/GrowingTextarea.tsx';

/**
 * What she says back while the card is being read — plain, and about what is actually happening.
 * It said "Reading that…", which named nothing (owner, 2026-09-07: "I don't know what reading
 * that means, it should clearly say what it's doing").
 */
export const READING = 'Looking up the nutrition for that…';

/** Lines before the composer stops growing and scrolls — a whole meal, dictated, fits. */
const COMPOSER_MAX_ROWS = 10;

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
 */
export function LogByChat({
  meal,
  listening = false,
  mode = 'log',
  mealLabel,
  onAppend,
  onLogged,
  onBack,
}: {
  meal: MealKind;
  /** Opened from the Voice tile — the mic starts live. */
  listening?: boolean;
  /**
   * Draft mode (meal-logging rework, 1b): this door APPENDS into the open meal — the confirm
   * card's button reads "Add to {meal}" and `onAppend` carries the rows through verbatim.
   */
  mode?: 'log' | 'draft';
  mealLabel?: string;
  onAppend?: (preview: MealPreview) => Promise<boolean>;
  onLogged: (preview: MealPreview) => void;
  onBack: () => void;
}) {
  const [text, setText] = useState('');
  const [said, setSaid] = useState<string | null>(null);
  const [preview, setPreview] = useState<MealPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const thread = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [said, busy, preview, err]);

  async function read() {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setErr('');
    setSaid(q);
    try {
      const p = await previewMeal(q, meal);
      if (!p.items.length) {
        setErr("I couldn't pick anything out of that — try naming the foods.");
        return;
      }
      setPreview(p);
      setText('');
    } catch {
      setErr("Couldn't read that just now — try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

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
        {busy && (
          <div className="fc-heard" role="status">
            {READING}
          </div>
        )}
        {preview && !busy && (
          <div className="fc-heard">
            Here&apos;s my read — an amount you gave I&apos;ve kept; anything you didn&apos;t, I&apos;ll ask.
          </div>
        )}
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
        {err && <div className="food-empty">{err}</div>}
      </div>

      {/* The composer is always here, mic included — that is what makes voice and chat one screen. */}
      <div className="fc-compose">
        <GrowingTextarea
          value={text}
          onChange={setText}
          disabled={busy}
          maxRows={COMPOSER_MAX_ROWS}
          ariaLabel="What did you have?"
          placeholder={preview ? 'Or just say the amount…' : 'What did you have? The whole meal is fine.'}
          onSubmit={() => void read()}
        />
        <MicButton value={text} onChange={setText} disabled={busy} autoStart={listening} />
        {text.trim() && (
          <button type="button" className="fc-send" disabled={busy} aria-label="Read that" onClick={() => void read()}>
            ›
          </button>
        )}
      </div>
    </div>
  );
}
