import { useEffect, useRef, useState } from 'react';
import type { Meal, MealKind, MealPreview } from '../../lib/api.ts';
import { useMealPhotoRead } from './useMealPhotoRead.ts';
import { MealParseCard } from './MealParseCard.tsx';
import { CoachReadLine } from './CoachReadLine.tsx';
import { HERE_IS, READ_FAILED } from './photoReadCopy.ts';
import { GrowingTextarea } from '../../components/GrowingTextarea.tsx';
import { MicButton } from '../../components/MicButton.tsx';

/** The photo door's add to the open meal: the rows, the words read, and the photo with its reading. */
export type AppendDraft = (
  items: MealPreview['items'],
  rawText: string,
  photo: { photo_ref?: string; photo_reading?: string },
) => Promise<boolean>;

/**
 * Photographing a meal, in three visible acts.
 *
 * The read costs 40–70s. Owner's ruling (2026-08-21): don't hide that, narrate it — *"this gives
 * the user the perception of movement and change. Any LLM message takes time; the boredom is
 * alleviated usually by seeing the stream of reasoning."*
 *
 *   caption  →  [reading: rotating copy]  →  THE READING, editable  →  [nutrition: rotating copy]  →  THE CARD
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
 * kcal would leave the wrong reason on file. The reading ends with a list — one food or drink a
 * line, the amount first — and each line is what gets looked up, so the fix goes on the line.
 *
 * WHY THE CARD IS THE TYPED DOOR'S (FOOD-LOGGING-COACH-LED.md, build step 4). The confirmed
 * reading goes through the same read as typed words: the coach decides once over what every
 * source found, the store prices, and the rows come back with her line, her trace, what she
 * assumed and what she would ask. The photo door shows them on the same card the chat door uses
 * (`MealParseCard` → `MealAmountRows`, `useMealAmounts`), so a photo of a latte and a banana
 * reads exactly as typing "a latte and a banana" does — a question row asks through the chips,
 * the not-reached notice is the same notice, a line that was not read is said so. Inside an open
 * meal (the quick log's photo door, the one live host) the card's confirm adds the rows AND the
 * photo with its reading to the meal; in log mode it writes the row with both on it.
 *
 * EVERY FAULT HAS A WAY FORWARD, IN PLAIN WORDS (review of #457). The eyes could not read the
 * photo → the box opens empty with the caption still counting; the read could not be worked out →
 * "Back to the reading" keeps every correction; a call past its bound is told so; and Back is
 * never disabled — leaving aborts whatever is in flight.
 *
 * WHY THE BUTTONS LIVE BELOW THE SCROLLER. The photo, the caption and a long reading are taller
 * than a phone, and the door's host clips rather than grows — so the confirm sat under the bottom
 * edge where it could be neither read nor pressed (owner, on device, 2026-10-31). The content
 * scrolls inside itself and the buttons are a fixed sibling under it, the chat composer's pattern
 * (`.fc-thread`), never a sticky element the keyboard could push out of the clip.
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
   * Draft mode (meal-logging rework, 1b): the photo appends into the open meal — the card's
   * button reads "Add to {meal}" and `appendDraft` carries the rows and the photo to the draft;
   * the caller owns closing the door, so `onLogged` never fires in this mode.
   */
  mode?: 'log' | 'draft';
  appendDraft?: AppendDraft;
  /** Log mode: the row the card wrote, so the host can settle what it was waiting on. */
  onLogged: (m: Meal) => void;
  onBack: () => void;
  /** Words already typed before the photo was attached — they are evidence, so they carry over. */
  initialCaption?: string;
  backLabel?: string;
}) {
  const [caption, setCaption] = useState(initialCaption);
  const draft = mode === 'draft' && !!appendDraft;
  const r = useMealPhotoRead();
  const working = r.phase === 'reading' || r.phase === 'nutrition';
  const said = caption.trim();
  const hasReading = !!r.reading.trim();
  // A failed read must not cost the meal: with a caption the coach can still read from the words.
  const fallbackLabel = said ? `Work it out from “${said}”` : null;

  // A result that lands below the photo is a result nobody sees — bring the card up to meet them.
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (r.phase === 'priced') cardRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [r.phase]);

  const leave = () => {
    r.cancel();
    onBack();
  };

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
          being worked out, and hiding it the moment the user confirms would take away the
          context exactly when the result arrives. */}
        {/* Gated on the PHASE, never on the text. Gating on `r.reading` unmounted the box the moment
          someone cleared it to rewrite it — so the one user who most wanted to correct the reading
          was the one who lost the field mid-edit. Reaching 'confirming' means the read completed;
          an empty box is then a fair invitation to say what it was. */}
        {(r.phase === 'confirming' || r.phase === 'nutrition') && (
          <div className="fl-reading">
            <p className="fl-note">{r.readFailed ? READ_FAILED : HERE_IS}</p>
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
            {/* Who read it, her work as it happened, and any line that was not read — the chat door's own line. */}
            <CoachReadLine coach={r.preview.coach} />
            <MealParseCard
              preview={r.preview}
              initialMeal={meal}
              mode={draft ? 'draft' : 'log'}
              mealLabel={meal}
              onAppend={
                draft
                  ? (p) =>
                      appendDraft!(p.items, p.raw_text, {
                        ...(p.photo_ref ? { photo_ref: p.photo_ref } : {}),
                        ...(p.photo_reading ? { photo_reading: p.photo_reading } : {}),
                      })
                  : undefined
              }
              onLogged={(logged) => {
                if (!draft && logged) onLogged(logged);
              }}
              onCancel={r.unprice}
            />
          </div>
        )}

        {/* Plain words, and a way forward, for every fault (photoReadCopy.ts). */}
        {r.phase === 'error' && <p className="fl-note">{r.error}</p>}
      </div>

      {/* The card carries its own buttons; every other phase keeps its decisions down here. */}
      {r.phase !== 'priced' && (
        <div className="fl-photo-foot">
          {r.phase === 'idle' && (
            <button type="button" className="fa-log" onClick={() => void r.read(photo, said)}>
              Have a look at this
            </button>
          )}
          {r.phase === 'confirming' && (
            <>
              {hasReading ? (
                <button type="button" className="fa-log" onClick={() => void r.commit({ caption: said, meal })}>
                  Work out the nutrition
                </button>
              ) : (
                fallbackLabel && (
                  <button
                    type="button"
                    className="fa-log"
                    onClick={() => void r.commit({ caption: said, meal, reading: '' })}
                  >
                    {fallbackLabel}
                  </button>
                )
              )}
              {r.readFailed && (
                <button type="button" className="lockbtn ghost" onClick={() => void r.read(photo, said)}>
                  Try reading it again
                </button>
              )}
            </>
          )}
          {r.phase === 'error' && r.failedAt === 'read' && (
            <>
              {fallbackLabel && (
                <button
                  type="button"
                  className="fa-log"
                  onClick={() => void r.commit({ caption: said, meal, reading: '' })}
                >
                  {fallbackLabel}
                </button>
              )}
              <button type="button" className="lockbtn ghost" onClick={() => void r.read(photo, said)}>
                Try reading it again
              </button>
            </>
          )}
          {r.phase === 'error' && r.failedAt === 'nutrition' && (
            <>
              {/* Their corrections are kept: back to the box as they left it, not to a fresh read. */}
              <button type="button" className="fa-log" onClick={r.unprice}>
                Back to the reading
              </button>
              {!hasReading && fallbackLabel && (
                <button
                  type="button"
                  className="lockbtn ghost"
                  onClick={() => void r.commit({ caption: said, meal, reading: '' })}
                >
                  {fallbackLabel}
                </button>
              )}
            </>
          )}
          {/* Never disabled: a hung request must not trap the person in the door. */}
          <button type="button" className="lockbtn ghost" onClick={leave}>
            {backLabel}
          </button>
        </div>
      )}
    </div>
  );
}
