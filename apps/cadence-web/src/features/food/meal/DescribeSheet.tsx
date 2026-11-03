/**
 * "What did you have?" — the pencil door, and the voice door with the mic already live (canvas
 * "Cadence Quick Log" 1a, 2026-10-29). A sheet over the drawer, not a screen of its own: the
 * shelves and the cart stay underneath, and closing it lands back on them.
 *
 * The words go to the same coach-led read the chat door uses (`previewMeal` → the software
 * looks every part up, the `food-check` job picks once, the store prices — FOOD-LOGGING-COACH-LED.md).
 * What comes back is listed, one row a food — name, P/C/F, the amount, kcal, × to drop a row —
 * and nothing enters the meal until "Looks right". An amount nobody said is shown as a question,
 * and it waits as a chip on the drawer the way it always has (draft mode: one unsettled amount
 * holds the log, never the add). "Not quite?" under the rows sends what is wrong back with the
 * same words, and the rows that come back take these rows' place (NotQuiteField, owner 2026-11-02).
 * A read or an add that fails says what happened and what to do, where the person is looking
 * (failureWords.ts); the words stay in the box either way.
 */
import { Fragment, useRef, useState } from 'react';
import { previewMeal, type MealKind, type MealPreview } from '../../../lib/api.ts';
import { CoachFace } from '../../../components/CoachFace.tsx';
import { GrowingTextarea } from '../../../components/GrowingTextarea.tsx';
import { MicButton } from '../../../components/MicButton.tsx';
import { PhotoButton } from '../../../components/PhotoButton.tsx';
import { downscalePhoto } from '../../plan/occurrence/format.ts';
import { fmtKcal } from '../bracket/copy.ts';
import { ANOTHER_GO, NOT_REACHED, NOT_REACHED_ANSWER, READING } from '../coachReadCopy.ts';
import { CoachTrace } from '../CoachTrace.tsx';
import { failureWords, type FailureWords } from '../failureWords.ts';
import { COULD_NOT_SETTLE } from '../MealAskedRow.tsx';
import { MealQuestionChoices } from '../MealQuestionChoices.tsx';
import { NotQuiteField } from '../NotQuiteField.tsx';
import { previousRows } from '../previousRows.ts';
import { REASKS_MAX, reReadAnswer, type AnswerResult } from '../reReadAnswer.ts';
import { settleButton } from '../settleWords.ts';
import { amountWords } from './amountWords.ts';
import { macroLine } from './macroLine.ts';

/** A row of the read, with how many times an answer brought it back as a question (never on the wire). */
type Row = MealPreview['items'][number] & { reasks?: number };
/** A row waiting on her question with answers to tap, still within the re-ask cap. */
const asksWithChoices = (r: Row): boolean => !!r.question && !!r.choices?.length && (r.reasks ?? 0) < REASKS_MAX;

/** When the read came back with no rows at all: a read, not a failure, so no retry button. */
export const NOTHING_READ = "I couldn't pick anything out of that — try naming the foods.";
/** When the add did not land and the drawer gave no reason of its own. */
export const ADD_DID_NOT_LAND = "That didn't make it into the meal. Nothing was lost — try Looks right again.";
export const TRY_AGAIN = 'Try again';

export function DescribeSheet({
  meal,
  seed = '',
  listening = false,
  busy,
  addFailure,
  onAdd,
  onClose,
  onPhoto,
}: {
  meal: MealKind;
  /** Words already typed elsewhere — the filter bar's "Tell the coach" hands its phrase over. */
  seed?: string;
  listening?: boolean;
  busy?: boolean;
  /** The drawer's own line for an add that failed (failureWords.ts), shown here when the add was this sheet's. */
  addFailure?: string;
  /** Append the rows verbatim into the open meal; resolves false when it did not land. */
  onAdd: (items: Row[], rawText: string) => Promise<boolean>;
  onClose: () => void;
  /** The camera (owner, 2026-11-01): the photo goes to the meal's photo read, the words as its caption. */
  onPhoto?: (photo: string, caption: string) => void;
}) {
  const [text, setText] = useState(seed);
  const [read, setRead] = useState<{
    for: string;
    rows: Row[];
    coach?: MealPreview['coach'];
    /** True when these rows are the re-read after "not quite". */
    corrected: boolean;
  } | null>(null);
  const [looking, setLooking] = useState(false);
  /** Re-reads in flight: the other rows' controls wait, so an answer never lands on a moved row. */
  const [answering, setAnswering] = useState(0);
  /** Set when an answer's re-read fell back to the automatic estimate: the sheet says so. */
  const [answerNotReached, setAnswerNotReached] = useState(false);
  /** The last read that failed, in words that say what happened and what to do. */
  const [fail, setFail] = useState<FailureWords | null>(null);
  /** The last add that did not land. */
  const [addFailed, setAddFailed] = useState(false);

  // The rows as last rendered, for an answer that lands after they have moved (answer()).
  const rowsRef = useRef<Row[]>([]);
  rowsRef.current = read?.rows ?? [];

  const words = text.trim();
  const fresh = read && read.for === words ? read.rows : null;
  const coach = read && read.for === words ? read.coach : undefined;
  // A row waiting on her question carries no number; it is not in the total until answered.
  const kcal = (fresh ?? []).filter((r) => !r.question).reduce((s, r) => s + (r.est?.kcal ?? 0), 0);
  // A question an amount cannot answer must not reach the meal with its question stripped (the add
  // keeps none of question/choices): the add waits while one is open, and while an answer is in
  // flight. An open amount does not hold it — that waits on the drawer, as it always has.
  const openChoices = (fresh ?? []).filter(asksWithChoices).length;
  const inFlight = answering > 0;
  /** What holds the add — ONE gate, read by the button and by Enter in the box alike. */
  const held = openChoices > 0 || inFlight;

  /** The read; with `correction`, the same words again with what was wrong and the rows as shown. */
  async function lookUp(correction?: string) {
    if (!words || looking) return;
    setLooking(true);
    setFail(null);
    setAddFailed(false);
    try {
      const previous = correction && fresh ? { words: correction, previous: previousRows(fresh) } : undefined;
      const p = previous ? await previewMeal(words, meal, previous) : await previewMeal(words, meal);
      if (!p.items.length) setFail({ line: NOTHING_READ, retry: false });
      setRead({ for: words, rows: p.items, coach: p.coach, corrected: !!previous });
    } catch (e) {
      setFail(failureWords(e, 'read'));
    } finally {
      setLooking(false);
    }
  }

  async function confirm() {
    if (!fresh?.length || busy || held) return;
    setAddFailed(false);
    if (await onAdd(fresh, words)) onClose();
    else setAddFailed(true);
  }

  const drop = (i: number) => setRead((r) => (r ? { ...r, rows: r.rows.filter((_, j) => j !== i) } : r));

  /**
   * Her question answered from this sheet — a tapped choice or a typed line. The part is re-read
   * with the answer (reReadAnswer.ts, the same call the confirm card makes) and the priced row(s)
   * take the asked row's place — found by the row itself, never by its index, so a row dropped
   * meanwhile cannot move the answer onto another — and "Looks right" adds a settled row. A
   * question again counts the re-ask; at REASKS_MAX the row goes to the drawer as an amount.
   */
  async function answer(i: number, text: string, chosen: boolean): Promise<AnswerResult> {
    const row = read?.rows[i];
    if (!row) return 'failed';
    setAnswering((n) => n + 1);
    try {
      const out = await reReadAnswer(row, text, chosen, meal);
      if (!out.ok) return out.reason;
      const fresh: Row[] = out.preview.items.map((it) => (it.question ? { ...it, reasks: (row.reasks ?? 0) + 1 } : it));
      // The row went away while the re-read ran: nothing to put the answer on, as the card's hook says.
      if (!rowsRef.current.includes(row)) return 'failed';
      setRead((r) => {
        const at = r ? r.rows.indexOf(row) : -1;
        return r && at >= 0 ? { ...r, rows: [...r.rows.slice(0, at), ...fresh, ...r.rows.slice(at + 1)] } : r;
      });
      if (out.preview.coach?.reached === false) setAnswerNotReached(true);
      return 'replaced';
    } finally {
      setAnswering((n) => n - 1);
    }
  }
  const ready = !!fresh?.length;
  const label = looking
    ? READING
    : openChoices > 0
      ? settleButton(openChoices, true)
      : ready
        ? `Looks right · ${fmtKcal(kcal)} kcal`
        : 'Look it up';
  const heading = coach?.reached === false ? NOT_REACHED : read?.corrected ? ANOTHER_GO : "Here's what I found";
  // The found block shows for rows, and for a read that left something out and read nothing else.
  const showFound = !!fresh && (fresh.length > 0 || !!coach?.not_read?.length);

  return (
    <>
      <div className="ms-ds-scrim" aria-hidden onClick={onClose} />
      <div className="ms-ds" role="dialog" aria-label="What did you have?">
        <div className="ms-grab" aria-hidden="true" />
        <div className="ms-ds-head">
          <h2>What did you have?</h2>
          <button type="button" className="ms-ds-x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="ms-ds-box">
          <GrowingTextarea
            value={text}
            onChange={setText}
            disabled={looking}
            maxRows={6}
            ariaLabel="What did you have?"
            placeholder="2 eggs on sourdough, flat white with oat milk…"
            onSubmit={() => void (ready ? confirm() : lookUp())}
          />
        </div>
        {showFound && (
          <div className="ms-ds-found">
            <div className="ms-ds-found-h">
              <CoachFace size={22} />
              <span>{heading}</span>
            </div>
            {/* Her work, drawn like a tool call: one line, the parts behind a tap; what was not read, in the open. */}
            <CoachTrace coach={coach} className="ms-ds-row-m" />
            {answerNotReached && <div className="ms-ds-row-m">{NOT_REACHED_ANSWER}</div>}
            {fresh!.map((r, i) => (
              <Fragment key={`${r.name}-${i}`}>
                <div className="ms-ds-row">
                  <div className="ms-ds-row-w">
                    <div className="ms-ds-row-n">{r.brand ? `${r.brand} ${r.name}` : r.name}</div>
                    {(macroLine(r.est) || r.basis === 'fallback' || r.assumption || r.question) && (
                      <div className="ms-ds-row-m">
                        {[
                          macroLine(r.est),
                          // A row the automatic estimate priced because she could not be reached says so.
                          r.basis === 'fallback' ? r.source_label : '',
                          r.assumption,
                          // Her question, or — when the buttons were tried REASKS_MAX times — that she could not settle it.
                          r.question && (r.reasks ?? 0) >= REASKS_MAX ? COULD_NOT_SETTLE : r.question,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    )}
                  </div>
                  <span className={`ms-ds-amt${r.qty == null ? ' is-ask' : ''}`}>{amountWords(r)}</span>
                  <span className="ms-ds-k">
                    <b>{fmtKcal(r.est?.kcal)}</b>
                    <i>KCAL</i>
                  </span>
                  <button
                    type="button"
                    className="ms-ds-drop"
                    aria-label={`Drop ${r.name}`}
                    disabled={inFlight || looking}
                    onClick={() => drop(i)}
                  >
                    ×
                  </button>
                </div>
                {/* Her answers as buttons under the row — the confirm card's own component, so the
                    two doors cannot drift (FOOD-LOGGING-COACH-LED.md, "chips in her voice"). */}
                {asksWithChoices(r) ? (
                  <div className="ms-ds-ask">
                    <MealQuestionChoices
                      name={r.name}
                      choices={r.choices!}
                      busy={busy || looking || inFlight}
                      onAnswer={(text, chosen) => answer(i, text, chosen)}
                    />
                  </div>
                ) : null}
              </Fragment>
            ))}
            {/* What is wrong, in their words, goes back with the same words and these rows. */}
            {ready && <NotQuiteField busy={busy || looking || inFlight} onCorrect={(w) => void lookUp(w)} />}
          </div>
        )}
        {fail && (
          <div className="food-fail" role="alert">
            <span>{fail.line}</span>
            {fail.retry && (
              <button type="button" disabled={looking} onClick={() => void lookUp()}>
                {TRY_AGAIN}
              </button>
            )}
          </div>
        )}
        {addFailed && (
          <div className="food-fail" role="alert">
            <span>{addFailure || ADD_DID_NOT_LAND}</span>
          </div>
        )}
        <div className="ms-ds-foot">
          <MicButton value={text} onChange={setText} disabled={looking} autoStart={listening} />
          {onPhoto && (
            <PhotoButton
              className="is-left"
              disabled={looking}
              onPick={([file]) => void downscalePhoto(file!).then((photo) => onPhoto(photo, words))}
            />
          )}
          <button
            type="button"
            className="ms-ds-go"
            disabled={!words || looking || busy || (ready && held)}
            onClick={() => void (ready ? confirm() : lookUp())}
          >
            {label}
          </button>
        </div>
      </div>
    </>
  );
}
