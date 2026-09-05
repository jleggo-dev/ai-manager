import { useEffect, useState } from 'react';
import {
  formatQuestionnaireAnswers,
  isQuestionnaireComplete,
  type PendingQuestionnaire,
  type QuestionnaireAnswers,
  type QuestionnaireQuestion,
} from '@cadence/shared';
import { clearQuestionnaire, getQuestionnaire } from '../../lib/api/questionnaire.ts';

/**
 * "A few questions" — the card the coach's `send_questionnaire` puts up.
 *
 * ChangeCard/WeekReviewCard/RepertoireOfferCard's fifth sibling, same contract: the tool writes a
 * pointer server-side because the chat wire is pure SSE prose — a tool call never reaches the
 * browser — so this asks the server what is up and draws nothing when the answer is nothing.
 *
 * **Sending is the person's act, and what they send is in their own words.** Tapping Send composes
 * ONE ordinary message — one line per question, "<label>: <answer>" — and hands it to the host,
 * which sends it the way a typed sentence goes. That is quick picks' rule (coach-picks.ts: a pick
 * composes a message, it never sends one) applied to a card: there is no submit endpoint, no
 * answers table, and nothing the coach can read that the person cannot see they said.
 *
 * **It never blocks the conversation.** Someone who would rather just type can ignore the card
 * entirely; the composer is untouched and the card is still there afterwards. "Not now" puts it
 * away for good.
 */

/** What the card says once it has been sent. A receipt, not a second editable copy — the person
 *  has already decided, and the answers are now visible in their own bubble above. */
function sentLine(n: number): string {
  return n === 1 ? '1 answer sent' : `${n} answers sent`;
}

/** One question and its control. Split out so the card's own body stays readable and each kind's
 *  markup sits next to the kind it draws. */
function Question({
  question,
  value,
  onChange,
}: {
  question: QuestionnaireQuestion;
  value: string | string[] | undefined;
  onChange: (next: string | string[]) => void;
}) {
  const picked = Array.isArray(value) ? value : value ? [value] : [];

  /** Re-tapping the chosen option clears it, exactly as quick picks do: an answer being drafted is
   *  not a commitment, and a single-select you cannot back out of is a trap on a touch screen. */
  const toggle = (option: string) => {
    if (question.kind === 'multi') {
      onChange(picked.includes(option) ? picked.filter((p) => p !== option) : [...picked, option]);
    } else {
      onChange(picked.includes(option) ? '' : option);
    }
  };

  return (
    <div className="qn-q">
      <div className="qn-label" id={`qn-${question.id}`}>
        {question.label}
      </div>
      {question.hint && <div className="qn-hint">{question.hint}</div>}
      {question.options ? (
        <div className="qn-options" role="group" aria-labelledby={`qn-${question.id}`}>
          {question.options.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={picked.includes(option)}
              className={`qp-row${picked.includes(option) ? ' is-picked' : ''}`}
              onClick={() => toggle(option)}
            >
              <span className="qp-label">{option}</span>
              {picked.includes(option) && (
                <span className="qp-check" aria-hidden>
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <input
          className="qn-field"
          type={question.kind === 'number' ? 'number' : 'text'}
          inputMode={question.kind === 'number' ? 'decimal' : 'text'}
          aria-labelledby={`qn-${question.id}`}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

export function QuestionnaireCard({
  onSend,
}: {
  /** The composed message — the host sends it as an ordinary turn, in the person's own bubble. */
  onSend?: (message: string) => void;
}) {
  const [pending, setPending] = useState<PendingQuestionnaire | null>(null);
  const [answers, setAnswers] = useState<QuestionnaireAnswers>({});
  const [sent, setSent] = useState(0);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let alive = true;
    void getQuestionnaire()
      .then((q) => {
        if (alive) setPending(q);
      })
      .catch(() => {
        /* her prose still says the questions are coming; a missing card is not a broken turn */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!pending || gone) return null;

  /** Both answers land here — sent, or put aside. Nothing else was stored by asking. */
  function answered() {
    void clearQuestionnaire().catch(() => {
      /* it stays up server-side; the next finished turn shows it again */
    });
  }

  if (sent) {
    return (
      <div className="cfm chg">
        <div className="cfm-mute">{sentLine(sent)}</div>
      </div>
    );
  }

  const questions = pending.questions;
  const complete = isQuestionnaireComplete(questions, answers);

  function send() {
    const message = formatQuestionnaireAnswers(questions, answers);
    if (!message) return;
    setSent(questions.length);
    answered();
    onSend?.(message);
  }

  function notNow() {
    setGone(true);
    answered();
  }

  return (
    <div className="cfm chg">
      <div className="chg-t">A few questions</div>
      {questions.map((q) => (
        <Question
          key={q.id}
          question={q}
          value={answers[q.id]}
          onChange={(next) => setAnswers((a) => ({ ...a, [q.id]: next }))}
        />
      ))}
      <button type="button" className="cfm-build" onClick={send} disabled={!complete}>
        Send
      </button>
      <button type="button" className="cfm-more" onClick={notNow}>
        Not now
      </button>
    </div>
  );
}
