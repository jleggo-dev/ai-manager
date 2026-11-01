import { useState } from 'react';

/** While the re-read runs. The coach speaks as "I" (BRAND.md). */
export const CHECKING = "I'm checking that…";
/** When the re-read failed: plain and kind, and the buttons stay. */
export const CHECK_FAILED = "I couldn't check that just now — try again, or type it.";
export const SOMETHING_ELSE = 'Something else';
export const THATS_IT = "That's it";

/**
 * Her question's answers as buttons (FOOD-LOGGING-COACH-LED.md, "chips in her voice"; owner,
 * 2026-11-01): one button per choice in her words, and "Something else" opening a one-line field —
 * so nobody has to type what they can tap, and anyone can type what the list left out. ONE
 * component for every door — the confirm card (MealAskedRow, so the chat door and the photo
 * door), the quick-log sheet (DescribeSheet) — so the buttons cannot drift between them.
 *
 * `onAnswer` runs the re-read: it resolves true when the row was replaced (this unmounts with
 * it) and false when it failed — the line then says so and the buttons stay for another go.
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
  /** `chosen` is true for a tapped button, false for a typed answer. Resolves false on failure. */
  onAnswer: (answer: string, chosen: boolean) => Promise<boolean>;
}) {
  const [own, setOwn] = useState('');
  const [showOwn, setShowOwn] = useState(false);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const disabled = busy || checking;

  async function answer(text: string, chosen: boolean) {
    const t = text.trim();
    if (!t || checking) return;
    setChecking(true);
    setFailed(false);
    const ok = await onAnswer(t, chosen);
    // On success the row is replaced and this unmounts; the failure is what has to be shown.
    setChecking(false);
    if (!ok) setFailed(true);
  }

  return (
    <div className="fa-choices">
      {checking && (
        <span className="fa-ask" role="status">
          {CHECKING}
        </span>
      )}
      {failed && !checking && <span className="fa-ask fa-ask-fail">{CHECK_FAILED}</span>}
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
        <div className="fa-own">
          <input
            className="wiz-in"
            value={own}
            placeholder="Say what it was"
            aria-label={`What the ${name} was`}
            disabled={disabled}
            onChange={(e) => setOwn(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void answer(own, false);
            }}
          />
          <button
            type="button"
            className="fa-chip"
            disabled={disabled || !own.trim()}
            onClick={() => void answer(own, false)}
          >
            {THATS_IT}
          </button>
        </div>
      )}
    </div>
  );
}
