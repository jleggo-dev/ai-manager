import { useState } from 'react';
import { previewMeal, type MealKind, type MealPreview } from '../../lib/api.ts';
import { MicButton } from '../../components/MicButton.tsx';
import { MealParseCard } from './MealParseCard.tsx';

/** What she says back while the card is being read — plain, and never about the food itself. */
const READING = 'Reading that…';

/**
 * Log by chat (design 05c) — and by voice, because **they are one screen**. The mic never leaves
 * the composer; opening with `listening` is the whole of what "Voice" means here. There is no
 * second interface to learn and no mode to be stuck in.
 *
 * What comes back is the parse-and-confirm card, which carries the amounts rule: an amount they
 * said is kept, an amount they didn't is asked for. Nothing counts until they tap it.
 */
export function LogByChat({
  meal,
  listening = false,
  onLogged,
  onBack,
}: {
  meal: MealKind;
  /** Opened from the Voice tile — the mic starts live. */
  listening?: boolean;
  onLogged: (preview: MealPreview) => void;
  onBack: () => void;
}) {
  const [text, setText] = useState('');
  const [said, setSaid] = useState<string | null>(null);
  const [preview, setPreview] = useState<MealPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

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
        <h2>Log by chat</h2>
        <span className="fc-slot">{meal}</span>
      </div>

      <div className="fc-thread">
        {said && <div className="fc-said">{said}</div>}
        {busy && <div className="fc-heard">{READING}</div>}
        {preview && !busy && (
          <div className="fc-heard">
            Here&apos;s my read — an amount you gave I&apos;ve kept; anything you didn&apos;t, I&apos;ll ask.
          </div>
        )}
        {preview && (
          <MealParseCard
            preview={preview}
            initialMeal={meal}
            onLogged={() => onLogged(preview)}
            onCancel={() => setPreview(null)}
          />
        )}
        {err && <div className="food-empty">{err}</div>}
      </div>

      {/* The composer is always here, mic included — that is what makes voice and chat one screen. */}
      <div className="fc-compose">
        <textarea
          className="mc-cap-in"
          rows={1}
          value={text}
          disabled={busy}
          aria-label="What did you have?"
          placeholder={preview ? 'Or just say the amount…' : 'What did you have?'}
          onChange={(e) => setText(e.target.value)}
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
