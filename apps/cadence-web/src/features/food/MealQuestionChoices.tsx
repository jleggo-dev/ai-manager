import { useState } from 'react';
import { ANSWER_MAX_CHARS } from '@cadence/shared';
import { OwnAnswerField } from './OwnAnswerField.tsx';
import type { AnswerResult } from './reReadAnswer.ts';

export { THATS_IT } from './OwnAnswerField.tsx';

/** While the re-read runs. The coach speaks as "I" (BRAND.md). */
export const CHECKING = "I'm checking that…";
/** When the re-read could not be made: plain and kind, and the buttons stay for another go. */
export const CHECK_FAILED = "I couldn't check that just now — try again, or type it.";
/** When the server refused the words as written (too long, or blank): the same answer again would fail the same way. */
export const CHECK_REJECTED = "I couldn't take that answer as written — try fewer words, or tap one of the buttons.";
export const SOMETHING_ELSE = 'Something else';

/**
 * Her question's answers as buttons (FOOD-LOGGING-COACH-LED.md, "chips in her voice"; owner,
 * 2026-11-01): one button per choice in her words, and "Something else" opening a one-line field —
 * so nobody has to type what they can tap, and anyone can type what the list left out. ONE
 * component for every door — the confirm card (MealAskedRow, so the chat door and the photo
 * door), the quick-log sheet (DescribeSheet) — so the buttons cannot drift between them.
 *
 * `onAnswer` runs the re-read and says what happened: `replaced` (the row is gone, this unmounts
 * with it), `rejected` (the words were refused — different words are needed, and the line says
 * so), `failed` (the re-read could not be made — the same words can be tried again). A typed
 * answer is cut to the server's own cap before it is sent, so a long one is never refused twice.
 */
export function MealQuestionChoices({
  name,
  choices,
  busy,
  onAnswer,
}: {
  /** The row's name, for the field's label. */
  name: string;
  choices: string[];
  busy?: boolean;
  /** `chosen` is true for a tapped button, false for a typed answer. */
  onAnswer: (answer: string, chosen: boolean) => Promise<AnswerResult>;
}) {
  const [showOwn, setShowOwn] = useState(false);
  const [checking, setChecking] = useState(false);
  const [outcome, setOutcome] = useState<Exclude<AnswerResult, 'replaced'> | null>(null);
  const disabled = busy || checking;

  async function answer(text: string, chosen: boolean) {
    const t = text.trim().slice(0, ANSWER_MAX_CHARS);
    if (!t || checking) return;
    setChecking(true);
    setOutcome(null);
    const result = await onAnswer(t, chosen);
    // On `replaced` the row is gone and this unmounts; the other two are what has to be shown.
    setChecking(false);
    if (result !== 'replaced') setOutcome(result);
  }

  return (
    <div className="fa-choices">
      {checking && (
        <span className="fa-ask" role="status">
          {CHECKING}
        </span>
      )}
      {outcome && !checking && (
        <span className="fa-ask fa-ask-fail">{outcome === 'rejected' ? CHECK_REJECTED : CHECK_FAILED}</span>
      )}
      <div className="fa-chips">
        {choices.map((c) => (
          <button type="button" key={c} className="fa-chip" disabled={disabled} onClick={() => void answer(c, true)}>
            {c}
          </button>
        ))}
        <button type="button" className="fa-chip" disabled={disabled} onClick={() => setShowOwn((v) => !v)}>
          {SOMETHING_ELSE}
        </button>
      </div>
      {showOwn && (
        <OwnAnswerField
          label={`What the ${name} was`}
          placeholder="Say what it was"
          canSend={(t) => !!t.trim()}
          disabled={disabled}
          maxLength={ANSWER_MAX_CHARS}
          onSend={(t) => void answer(t, false)}
        />
      )}
    </div>
  );
}
