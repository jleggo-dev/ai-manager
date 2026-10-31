import { useEffect, useRef, useState } from 'react';
import type { Meal, MealKind, MealPreview } from '../../lib/api.ts';
import { useMealPhotoRead } from './useMealPhotoRead.ts';
import { MealParseCard } from './MealParseCard.tsx';
import { GrowingTextarea } from '../../components/GrowingTextarea.tsx';
import { MicButton } from '../../components/MicButton.tsx';

/**
 * Photographing a meal, in three visible acts.
 *
 * The read costs 40–70s. Owner's ruling (2026-08-21): don't hide that, narrate it — *"this gives
 * the user the perception of movement and change. Any LLM message takes time; the boredom is
 * alleviated usually by seeing the stream of reasoning."*
 *
 *   caption  →  [reading: rotating copy]  →  THE READING, editable  →  [nutrition: rotating copy]
 *
 * Its own file rather than another branch in the meal screen, which has its own size budget and would be
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
 *
 * WHY THE BUTTONS LIVE BELOW THE SCROLLER. The photo, the caption and a long reading are taller
 * than a phone, and the door's host clips rather than grows — so the confirm sat under the bottom
 * edge where it could be neither read nor pressed (owner, on device, 2026-10-31). The content
 * scrolls inside itself and the buttons are a fixed sibling under it, the chat composer's pattern
 * (`.fc-thread`), never a sticky element the keyboard could push out of the clip.
 *
 * WHY DRAFT MODE STOPS AT THE NUMBERS. Inside an open meal the read is priced and shown on the
 * same card the typed path uses — the foods, their amounts, kcal and macros — and only "Add to
 * dinner" there joins them to the meal. Before, the numbers were never seen until the meal closed.
 */
export function PhotoReadPanel({
  photo,
  meal,
  mode = 'log',
  appendDraft,
  onLogged,
  onBack,
  initialCaption = '',
  backLabel = 'Back',
}: {
  photo: string;
  meal: MealKind;
  /**
   * Draft mode (meal-logging rework, 1b): the photo appends into the open meal — the confirm
   * button reads "Add to {meal}" and `appendDraft` carries the priced rows to the draft; the
   * caller owns closing the door, so `onLogged` never fires in this mode.
   */
  mode?: 'log' | 'draft';
  appendDraft?: (items: MealPreview['items'], rawText: string) => Promise<boolean>;
  onLogged: (m: Meal) => void;
  onBack: () => void;
  /** Words already typed before the photo was attached — they are evidence, so they carry over. */
  initialCaption?: string;
  backLabel?: string;
}) {
  const [caption, setCaption] = useState(initialCaption);
  const draft = mode === 'draft' && !!appendDraft;
  const r = useMealPhotoRead(draft);
  const working = r.phase === 'reading' || r.phase === 'nutrition';
  const commitLabel = draft ? 'Work out the nutrition' : `Log to ${meal}`;
  const said = caption.trim();
  const fallbackLabel = draft
    ? said
      ? `Work it out from “${said}”`
      : null
    : said
      ? `Log “${said}” to ${meal}`
      : `Log to ${meal} anyway`;

  // A result that lands below the photo is a result nobody sees — bring the card up to meet them.
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (r.phase === 'priced') cardRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [r.phase]);

  return (
    <div className="fl-photo">
      <div className="fl-body fl-photo-scroll">
        <img src={photo} alt="your plate" />

        {r.phase === 'idle' && (
          /* Mic beside the box, exactly where it sits in the coach's composer and on the plan's
              capture row — brief 01. This is the caption the dill-pickle incident was dictated
              into, and voice is precisely why captions get long enough to need re-reading. */
          <div className="fl-cap-row">
            <GrowingTextarea
              value={caption}
              onChange={setCaption}
              ariaLabel="A few words about the photo"
              placeholder="a few words help — “chicken burrito bowl”"
            />
            <MicButton value={caption} onChange={setCaption} />
          </div>
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

        {r.phase === 'priced' && r.preview && (
          <div ref={cardRef}>
            <MealParseCard
              preview={r.preview}
              initialMeal={meal}
              mode="draft"
              mealLabel={meal}
              onAppend={(p) => appendDraft!(p.items, p.raw_text)}
              onLogged={() => {}}
              onCancel={r.unprice}
            />
          </div>
        )}

        {/* A failed read must not cost the meal — the 2026-08-20 rule. The photo is already stored,
          so working from the caption alone is still open, and saying so is better than a retry
          button that offers no way forward. */}
        {r.phase === 'error' && <p className="fl-note">{r.error || 'That didn’t go through.'}</p>}
      </div>

      {/* The card carries its own buttons; every other phase keeps its one decision down here. */}
      {r.phase !== 'priced' && (
        <div className="fl-photo-foot">
          {r.phase === 'idle' && (
            <button type="button" className="fa-log" onClick={() => void r.read(photo, said)}>
              Have a look at this
            </button>
          )}
          {r.phase === 'confirming' && (
            <button
              type="button"
              className="fa-log"
              onClick={() => void r.commit({ caption: said, meal }).then((m) => m && onLogged(m))}
            >
              {commitLabel}
            </button>
          )}
          {r.phase === 'error' && (
            <>
              {fallbackLabel && (
                <button
                  type="button"
                  className="fa-log"
                  onClick={() => void r.commit({ caption: said, meal, reading: '' }).then((m) => m && onLogged(m))}
                >
                  {fallbackLabel}
                </button>
              )}
              <button type="button" className="lockbtn ghost" onClick={() => void r.read(photo, said)}>
                Try reading it again
              </button>
            </>
          )}
          <button type="button" className="lockbtn ghost" disabled={working} onClick={onBack}>
            {backLabel}
          </button>
        </div>
      )}
    </div>
  );
}
