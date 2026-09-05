/**
 * The composed message is a deterministic router in the sense CLAUDE.md means: it decides what the
 * coach reads, it decides silently, and nothing throws when it gets it wrong. So it ships with a
 * table of good and near-miss inputs — a blank answer, an untouched multi-select, a number typed
 * as text, an id nobody asked about — rather than one happy path.
 */
import { describe, expect, it } from 'vitest';
import {
  CHOICE_KINDS,
  MAX_CHOICES,
  MAX_QUESTIONS,
  MIN_CHOICES,
  MIN_QUESTIONS,
  QUESTION_KINDS,
  formatQuestionnaireAnswers,
  isAnswered,
  isQuestionnaireComplete,
  type QuestionnaireQuestion,
} from './questionnaire.ts';

const QUESTIONS: QuestionnaireQuestion[] = [
  { id: 'days_free', label: 'Which days are usually free?', kind: 'multi', options: ['Mon', 'Tue', 'Sat'] },
  { id: 'session_length', label: 'How long can a session be?', kind: 'number', hint: 'minutes' },
  { id: 'where', label: 'Where will you be training?', kind: 'choice', options: ['Home', 'Gym'] },
  { id: 'anything_else', label: 'Anything I should know?', kind: 'text' },
];

describe('formatQuestionnaireAnswers', () => {
  const table: Array<[string, Record<string, string | string[]>, string]> = [
    [
      'one line per question, in the order she asked them',
      { days_free: ['Mon', 'Sat'], session_length: '45', where: 'Gym', anything_else: 'knee is still sore' },
      [
        'Which days are usually free?: Mon, Sat',
        'How long can a session be?: 45',
        'Where will you be training?: Gym',
        'Anything I should know?: knee is still sore',
      ].join('\n'),
    ],
    [
      'leaves out a question nobody answered rather than sending a blank line',
      { days_free: ['Mon'], session_length: '' },
      'Which days are usually free?: Mon',
    ],
    [
      'treats an untouched multi-select as unanswered, not as an empty list',
      { days_free: [], where: 'Home' },
      'Where will you be training?: Home',
    ],
    [
      'trims the answer and drops the blanks inside a multi-select',
      { days_free: ['  Mon  ', '', 'Sat'], session_length: '  30 ' },
      'Which days are usually free?: Mon, Sat\nHow long can a session be?: 30',
    ],
    ['answers nothing when nothing was answered', {}, ''],
    [
      'ignores an answer keyed to a question she never asked',
      { not_a_question: 'hello', where: 'Gym' },
      'Where will you be training?: Gym',
    ],
  ];

  for (const [what, answers, expected] of table) {
    it(what, () => {
      expect(formatQuestionnaireAnswers(QUESTIONS, answers)).toBe(expected);
    });
  }

  it('repeats the label, never the id — the person has to be able to read what they said', () => {
    const out = formatQuestionnaireAnswers(QUESTIONS, { days_free: ['Mon'] });
    expect(out).toContain('Which days are usually free?');
    expect(out).not.toContain('days_free');
  });
});

describe('isAnswered / isQuestionnaireComplete', () => {
  it('holds Send until every question has something in it', () => {
    expect(isQuestionnaireComplete(QUESTIONS, { days_free: ['Mon'], session_length: '45', where: 'Gym' })).toBe(false);
    expect(
      isQuestionnaireComplete(QUESTIONS, {
        days_free: ['Mon'],
        session_length: '45',
        where: 'Gym',
        anything_else: 'no',
      }),
    ).toBe(true);
  });

  it('counts whitespace as unanswered', () => {
    const free: QuestionnaireQuestion = { id: 'anything_else', label: 'Anything I should know?', kind: 'text' };
    expect(isAnswered(free, { anything_else: '   ' })).toBe(false);
    expect(isAnswered(free, { anything_else: ' no ' })).toBe(true);
  });

  it('is false for an empty question list — an empty card has nothing to send', () => {
    expect(isQuestionnaireComplete([], {})).toBe(false);
  });
});

describe('the bounds both sides read', () => {
  it('are ordered, so no bound can accept what the other refuses', () => {
    expect(MIN_QUESTIONS).toBeLessThan(MAX_QUESTIONS);
    expect(MIN_CHOICES).toBeLessThan(MAX_CHOICES);
  });

  it('name only kinds the card can draw', () => {
    expect([...QUESTION_KINDS]).toEqual(['text', 'number', 'choice', 'multi']);
    expect([...CHOICE_KINDS].every((k) => QUESTION_KINDS.includes(k))).toBe(true);
  });
});
