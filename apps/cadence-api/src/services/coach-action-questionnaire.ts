import {
  CHOICE_KINDS,
  MAX_CHOICES,
  MAX_CHOICE_LABEL,
  MAX_HINT,
  MAX_QUESTIONS,
  MAX_QUESTION_LABEL,
  MIN_CHOICES,
  MIN_QUESTIONS,
  QUESTION_KINDS,
  type QuestionKind,
  type QuestionnaireQuestion,
} from '@cadence/shared';
import { setPendingQuestionnaire } from '../repos/users.ts';
import type { CoachActionTool } from './coach-action-types.ts';

/**
 * `send_questionnaire` — a short set of questions on their screen, answers back as their words.
 *
 * The persona has promised this since v2 ("offer to send a short questionnaire instead of
 * interrogating them in chat") and no such surface existed anywhere in the app. What she had was
 * one question's worth of tappable answers per turn (the quick-picks block), which is the right
 * shape for a conversation and the wrong shape for the five separate facts a plan sometimes needs
 * before it can be built at all — five turns of one-line questions, each costing a full generation.
 *
 * Own file from day one, like `offer_repertoire_review` and `update_constraint` before it, and for
 * the same reason: coach-actions.ts sits near its size gate, and a tool whose whole contract is a
 * boundary wants the room to state it.
 *
 * **She may ask; she may not answer.** The tool writes a POINTER to the questions and nothing
 * else — no answers table, no submission endpoint. The card composes ONE ordinary user message,
 * one line per question, and sends it through the same path a typed sentence takes, so what the
 * coach reads is what the person can see they said, and ambient capture works on it unchanged.
 * That is quick picks' own rule (packages/cadence-shared/src/coach-picks.ts: a pick composes a
 * message, it never sends one) carried to a whole card.
 *
 * The mechanism is `open_week_review`'s and `offer_repertoire_review`'s, copied rather than
 * reinvented: the chat wire is pure SSE prose, so a tool call never reaches the browser, and
 * persisting the pointer is what makes "the questions are on their screen" true. There is no
 * second step and no tag, so this tool is complete in one call (TOOL-HARNESS.md §5).
 *
 * **Validation refuses; it never truncates.** A seventh question dropped quietly is a question the
 * coach believes she asked and will wait forever for an answer to, so an over-long set is rejected
 * whole with the count that broke it. Same for a `choice` with one option, a duplicate id, and a
 * kind no card can draw: the rejection says what was wrong and nothing goes up.
 */

/** Answers are keyed by this, so it has to be a name and not a sentence. */
const ID_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

interface RawQuestion {
  id?: unknown;
  label?: unknown;
  kind?: unknown;
  options?: unknown;
  hint?: unknown;
}

/** One question checked against the shared bounds. Returns the fault in plain words, or the
 *  question ready to store. `at` is 1-based because it is quoted back to the coach. */
function readQuestion(raw: RawQuestion, at: number): { fault: string } | { question: QuestionnaireQuestion } {
  const id = str(raw.id).toLowerCase();
  if (!ID_PATTERN.test(id)) {
    return {
      fault: `question ${at} has no usable "id" (got ${JSON.stringify(str(raw.id))}) — an id is lower-case letters, digits and underscores, starting with a letter, like "days_free"`,
    };
  }

  const label = str(raw.label);
  if (!label) return { fault: `question ${at} ("${id}") has no "label" — that is the question itself` };
  if (label.length > MAX_QUESTION_LABEL) {
    return {
      fault: `question ${at} ("${id}") is ${label.length} characters long and the limit is ${MAX_QUESTION_LABEL}`,
    };
  }

  const kind = str(raw.kind).toLowerCase() as QuestionKind;
  if (!QUESTION_KINDS.includes(kind)) {
    return {
      fault: `question ${at} ("${id}") has kind ${JSON.stringify(str(raw.kind))} — the kinds are ${QUESTION_KINDS.join(', ')}`,
    };
  }

  const question: QuestionnaireQuestion = { id, label, kind };

  if (CHOICE_KINDS.includes(kind)) {
    const seen = new Set<string>();
    const options = (Array.isArray(raw.options) ? raw.options : [])
      .map((o) => str(o).slice(0, MAX_CHOICE_LABEL))
      .filter((o) => {
        const key = o.toLowerCase();
        if (!o || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    if (options.length < MIN_CHOICES || options.length > MAX_CHOICES) {
      return {
        fault: `question ${at} ("${id}") is a ${kind} question with ${options.length} usable option${options.length === 1 ? '' : 's'} — a ${kind} question needs between ${MIN_CHOICES} and ${MAX_CHOICES}`,
      };
    }
    question.options = options;
  }
  // `text` and `number` carry no options: a typed answer has nothing to pick from, and storing
  // buttons the card will never draw would leave the coach expecting a choice she cannot get.

  const hint = str(raw.hint).slice(0, MAX_HINT);
  if (hint) question.hint = hint;

  return { question };
}

/** The whole set, or the first fault in it. Reported one at a time on purpose: a list of six
 *  faults is a wall she has to re-read, and fixing the first often fixes the rest. */
function readQuestions(raw: unknown): { fault: string } | { questions: QuestionnaireQuestion[] } {
  const list = Array.isArray(raw) ? (raw as RawQuestion[]) : [];
  if (list.length < MIN_QUESTIONS || list.length > MAX_QUESTIONS) {
    return {
      fault: `${list.length} question${list.length === 1 ? ' was' : 's were'} given and a questionnaire holds between ${MIN_QUESTIONS} and ${MAX_QUESTIONS}`,
    };
  }

  const questions: QuestionnaireQuestion[] = [];
  const ids = new Set<string>();
  for (const [i, entry] of list.entries()) {
    const read = readQuestion(entry && typeof entry === 'object' ? entry : {}, i + 1);
    if ('fault' in read) return read;
    if (ids.has(read.question.id)) {
      return { fault: `two questions share the id "${read.question.id}" — each one needs its own` };
    }
    ids.add(read.question.id);
    questions.push(read.question);
  }
  return { questions };
}

export const SEND_QUESTIONNAIRE: CoachActionTool = {
  name: 'send_questionnaire',
  /**
   * Under the 800-char action bound (TOOL-HARNESS.md §1), asserted in this tool's own test — the
   * harness audit reads only the tools declared every turn and cannot reach a tail one.
   *
   * Plain and literal (owner ruling 2026-09-03): it says what the tool does, what comes back, and
   * what it does not do. It does NOT say when she should prefer a card to a conversation beyond
   * the one factual tiebreak — how many things to ask, and whether to ask at all, is hers.
   */
  description:
    'Put a short set of questions on the user\'s screen as one card they fill in and send. Use it when you need several separate answers and asking one at a time would take many turns; ask in chat instead when one question will do. This writes nothing: their answers come back as their own message when they send the card, and nothing is on file until then. Pass {"questions": [{"id": "days_free", "label": "Which days are usually free?", "kind": "multi", "options": ["Mon", "Wed", "Sat"]}, {"id": "session_length", "label": "How long can a session be?", "kind": "number", "hint": "in minutes"}]}. Two to six questions. "kind" is text, number, choice or multi; choice and multi need two to eight "options". "id" is lower-case with underscores. "hint" is optional — it says what the question is for.',
  parameters: {
    properties: {
      questions: {
        type: 'array',
        description: `Two to ${MAX_QUESTIONS} questions. More than ${MAX_QUESTIONS} is refused rather than shortened.`,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Lower-case name with underscores, unique in this set.' },
            label: { type: 'string', description: 'The question itself, in your words — this is what they read.' },
            // Derived from the shared union, never hand-copied: a kind the card cannot draw would
            // be a question nobody can answer (packages/cadence-shared/src/questionnaire.ts).
            kind: { type: 'string', enum: [...QUESTION_KINDS] },
            options: {
              type: 'array',
              items: { type: 'string' },
              description: `Required for choice and multi: ${MIN_CHOICES} to ${MAX_CHOICES} answers to pick from. Leave it out for text and number.`,
            },
            hint: {
              type: 'string',
              description:
                'Optional line under the question saying what it is for. Omit it and the question stands alone.',
            },
          },
          required: ['id', 'label', 'kind'],
        },
      },
    },
    required: ['questions'],
  },
  async run(userId, params) {
    const read = readQuestions(params.questions);
    if ('fault' in read) {
      // The fault and nothing else. What to do about it — call again with a fixed set, or drop the
      // card and keep talking — is hers (owner red line 2026-09-03: facts, not picks).
      return `Nothing is on their screen: ${read.fault}.`;
    }

    try {
      await setPendingQuestionnaire(userId, { questions: read.questions, sent_at: new Date().toISOString() });
    } catch (e) {
      console.error('[send_questionnaire] write failed:', e);
      // An honesty guard, which the red line allows, and no instruction about what to do instead.
      return 'The questionnaire did NOT go up — saving it failed. Nothing is on their screen; do not say there is.';
    }

    // Facts only (owner red line 2026-09-03): what happened, what is now true, and the honesty
    // guard. Nothing about what to say next, how long to speak, or what to offer.
    return `A questionnaire with ${read.questions.length} questions is on their screen. Their answers arrive as their own message when they send it; nothing is recorded until then.`;
  },
};
