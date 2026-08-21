import { useState } from 'react';
import type { Meal, MealKind } from '../../lib/api.ts';
import { useMealPhotoRead } from './useMealPhotoRead.ts';

/**
 * Photographing a meal, in three visible acts.
 *
 * The read costs 40–70s. Owner's ruling (2026-08-21): don't hide that, narrate it — *"this gives
 * the user the perception of movement and change. Any LLM message takes time; the boredom is
 * alleviated usually by seeing the stream of reasoning."*
 *
 *   caption  →  [reading: rotating copy]  →  THE READING, editable  →  [nutrition: rotating copy]
 *
 * Its own file rather than another branch in `LogScreen`, which is already 227 lines and would be
 * mixing "route between capture methods" with "run a two-stage read" — a distinct responsibility
 * gets its own file from day one.
 *
 * WHY THE CAPTION COMES FIRST. It could be typed while the read runs, and that would look faster.
 * But the caption is evidence the photo cannot give — the brand, what's in the sauce, "this is the
 * smaller one" — and stage 1 is told to trust it for exactly those. Collecting it after the read
 * would mean the eyes never saw the one thing only the user knows.
 *
 * WHY THE READING IS EDITABLE. This is the confirm step, and it works at the cause rather than the
 * symptom: "that's oat milk" changes the reading and every number derived from it, where editing
 * kcal would leave the wrong reason on file. Stage 2 is told the user is right about WHAT it was
 * and the photo is right about HOW MUCH, so the correction wins where it should.
 */
export function PhotoReadPanel({
  photo,
  meal,
  onLogged,
  onBack,
}: {
  photo: string;
  meal: MealKind;
  onLogged: (m: Meal) => void;
  onBack: () => void;
}) {
  const [caption, setCaption] = useState('');
  const r = useMealPhotoRead();
  const working = r.phase === 'reading' || r.phase === 'nutrition';

  return (
    <div className="fl-body fl-photo">
      <img src={photo} alt="your plate" />

      {r.phase === 'idle' && (
        <>
          <input
            className="mc-cap-in"
            value={caption}
            aria-label="A few words about the photo"
            placeholder="a few words help — “chicken burrito bowl”"
            onChange={(e) => setCaption(e.target.value)}
          />
          <button type="button" className="fa-log" onClick={() => void r.read(photo, caption.trim())}>
            Have a look at this
          </button>
        </>
      )}

      {working && (
        <p className="fl-progress" aria-live="polite">
          {r.progress}
        </p>
      )}

      {/* The reading stays on screen through stage 2 — it is the explanation for the numbers
          being calculated, and hiding it the moment the user confirms would take away the
          context exactly when the result arrives. */}
      {/* Gated on the PHASE, never on the text. Gating on `r.reading` unmounted the box the moment
          someone cleared it to rewrite it — so the one user who most wanted to correct the reading
          was the one who lost the field mid-edit. Reaching 'confirming' means the read completed;
          an empty box is then a fair invitation to say what it was. */}
      {(r.phase === 'confirming' || r.phase === 'nutrition') && (
        <div className="fl-reading">
          <p className="fl-note">Here’s what I can see — fix anything I got wrong.</p>
          <textarea
            className="fl-reading-text"
            value={r.reading}
            aria-label="What the photo shows"
            rows={10}
            disabled={r.phase === 'nutrition'}
            onChange={(e) => r.setReading(e.target.value)}
          />
        </div>
      )}

      {r.phase === 'confirming' && (
        <button
          type="button"
          className="fa-log"
          onClick={() => void r.commit({ caption: caption.trim(), meal }).then((m) => m && onLogged(m))}
        >
          {`Log to ${meal}`}
        </button>
      )}

      {/* A failed read must not cost the meal — the 2026-08-20 rule. The photo is already stored,
          so logging from the caption alone is still open, and saying so is better than a retry
          button that offers no way forward. */}
      {r.phase === 'error' && (
        <>
          <p className="fl-note">{r.error || 'That didn’t go through.'}</p>
          <button
            type="button"
            className="fa-log"
            onClick={() => void r.commit({ caption: caption.trim(), meal, reading: '' }).then((m) => m && onLogged(m))}
          >
            {caption.trim() ? `Log “${caption.trim()}” to ${meal}` : `Log to ${meal} anyway`}
          </button>
          <button type="button" className="lockbtn ghost" onClick={() => void r.read(photo, caption.trim())}>
            Try reading it again
          </button>
        </>
      )}

      <button type="button" className="lockbtn ghost" disabled={working} onClick={onBack}>
        Back
      </button>
    </div>
  );
}
