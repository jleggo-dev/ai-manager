/**
 * The questionnaire contract — one short set of questions, shared by the tool that sends it, the
 * column that stores it, and the card that renders it.
 *
 * **Why it is shared and not stated three times.** A hand-copied union WILL drift: `FOOD_SOURCES`
 * was stale in the web client for weeks and quick-add answered nothing (#346). The kinds a
 * question can take decide which control the card draws AND which shapes the tool will accept, so
 * they are declared once here and both sides read them.
 *
 * **The answers are the person's own message, not a form submission.** This is the same rule quick
 * picks live by (coach-picks.ts): what the coach receives is what the user can see they said. The
 * card composes one message — one line per question, "<label>: <answer>" — and sends it as an
 * ordinary turn, so the coach reads it exactly as she would read the same words typed out, and
 * ambient capture works on it unchanged. There is no answers table and no submission endpoint; a
 * questionnaire that landed anywhere else would be a second way of knowing things about someone.
 */

/** The controls a question can be answered with. Derived from here on both sides — never retyped. */
export const QUESTION_KINDS = ['text', 'number', 'choice', 'multi'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

/** Fewer than two is a chat question, and sending a card for it is slower than asking. */
export const MIN_QUESTIONS = 2;
/** More than six is a form. The tool refuses rather than truncating: a silently dropped question
 *  is one the coach thinks she asked and never gets an answer to. */
export const MAX_QUESTIONS = 6;
/** A single-option choice is not a choice. */
export const MIN_CHOICES = 2;
/** Past this the buttons stop fitting a phone; the same bound quick picks use for one turn. */
export const MAX_CHOICES = 8;
/** A question, not a paragraph. */
export const MAX_QUESTION_LABEL = 120;
/** One button's words. */
export const MAX_CHOICE_LABEL = 60;
/** The small line under a question — what it is for, never an example answer (owner ruling
 *  2026-09-03: a hint that shows an answer reads as the expected one). */
export const MAX_HINT = 80;

/** Which kinds are answered by picking from `options` rather than typing. */
export const CHOICE_KINDS: readonly QuestionKind[] = ['choice', 'multi'];

export interface QuestionnaireQuestion {
  /** Stable snake_case name for the question. Keys the answer; never shown to anyone. */
  id: string;
  /** The question in the coach's own words — this is what the person reads and what the composed
   *  message repeats back, so the two can never disagree. */
  label: string;
  kind: QuestionKind;
  /** The buttons, for `choice` and `multi`. Absent for `text` and `number`. */
  options?: string[];
  /** What the question is for, when the label alone leaves it open. Optional. */
  hint?: string;
}

/** What the column holds while the card is up: the questions and when she sent them. No answers —
 *  those are a message, and a message is not stored twice. */
export interface PendingQuestionnaire {
  questions: QuestionnaireQuestion[];
  sent_at: string;
}

/** One question's answer: typed text, or the picked option(s). */
export type QuestionnaireAnswer = string | string[];

/** Answers keyed by `question.id`. */
export type QuestionnaireAnswers = Record<string, QuestionnaireAnswer | undefined>;

/** "a, b, c" — a multi-select reads back as a plain list, the way someone would type it. */
function joinAnswer(value: QuestionnaireAnswer): string {
  return (Array.isArray(value) ? value : [value])
    .map((v) => String(v).trim())
    .filter(Boolean)
    .join(', ');
}

/** Whether one question has an answer worth sending. An untouched multi-select is an empty array,
 *  which is the same as unanswered — a picker they never touched said nothing. */
export function isAnswered(question: QuestionnaireQuestion, answers: QuestionnaireAnswers): boolean {
  return joinAnswer(answers[question.id] ?? '').length > 0;
}

/** Every question answered — what the Send button waits for. */
export function isQuestionnaireComplete(
  questions: readonly QuestionnaireQuestion[],
  answers: QuestionnaireAnswers,
): boolean {
  return questions.length > 0 && questions.every((q) => isAnswered(q, answers));
}

/**
 * The message the card sends, in the person's own bubble.
 *
 * One line per answered question, "<label>: <answer>", in the order she asked them. The label is
 * repeated rather than the id because the id means nothing to anyone reading the thread — and the
 * person has to be able to see what they said, which is the whole reason this goes through the
 * ordinary send path instead of a hidden submission.
 *
 * Unanswered questions are left out rather than sent blank: a line reading "How long? :" is a
 * sentence the person did not write. Returns '' when nothing was answered, which is what leaves
 * the send inert.
 */
export function formatQuestionnaireAnswers(
  questions: readonly QuestionnaireQuestion[],
  answers: QuestionnaireAnswers,
): string {
  return questions
    .map((q) => ({ label: q.label.trim(), value: joinAnswer(answers[q.id] ?? '') }))
    .filter((line) => line.value.length > 0)
    .map((line) => `${line.label}: ${line.value}`)
    .join('\n');
}
