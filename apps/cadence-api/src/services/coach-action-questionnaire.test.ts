/**
 * `send_questionnaire` — the questions go up, and nothing else does.
 *
 * The load-bearing assertions here are negatives. This tool exists so the coach can ask several
 * things at once WITHOUT any of it becoming a record: the answers are the person's own message,
 * sent from a card they are looking at. A version that stored an answer, or that quietly dropped a
 * seventh question, would pass every positive test below and would leave her either holding words
 * nobody said or waiting on an answer to a question that never appeared.
 *
 * So: a validation table with the near-misses (one question, seven questions, a choice with one
 * option, a duplicate id, a kind the card cannot draw), and the pointer asserted to carry the
 * questions and nothing more.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('../repos/users.ts', () => ({ setPendingQuestionnaire: vi.fn(async () => undefined) }));

import { setPendingQuestionnaire } from '../repos/users.ts';
import { SEND_QUESTIONNAIRE } from './coach-action-questionnaire.ts';

/** A well-formed pair — the smallest thing this tool will accept. */
const TWO = [
  { id: 'days_free', label: 'Which days are usually free?', kind: 'multi', options: ['Mon', 'Wed', 'Sat'] },
  { id: 'session_length', label: 'How long can a session be?', kind: 'number', hint: 'in minutes' },
];

/** The one argument every assertion about the pointer reads. */
function pointer(): { questions?: unknown[]; sent_at?: unknown } {
  const call = vi.mocked(setPendingQuestionnaire).mock.calls[0];
  return (call?.[1] ?? {}) as { questions?: unknown[]; sent_at?: unknown };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('send_questionnaire — what it puts up', () => {
  it('stores the questions as given and stamps when they went up', async () => {
    await SEND_QUESTIONNAIRE.run('u1', { questions: TWO });

    expect(setPendingQuestionnaire).toHaveBeenCalledTimes(1);
    expect(vi.mocked(setPendingQuestionnaire).mock.calls[0]![0]).toBe('u1');
    expect(pointer().questions).toEqual([
      { id: 'days_free', label: 'Which days are usually free?', kind: 'multi', options: ['Mon', 'Wed', 'Sat'] },
      { id: 'session_length', label: 'How long can a session be?', kind: 'number', hint: 'in minutes' },
    ]);
    expect(typeof pointer().sent_at).toBe('string');
  });

  it('accepts six questions, the most a card holds', async () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ id: `q_${i}`, label: `Question ${i}?`, kind: 'text' }));
    const out = await SEND_QUESTIONNAIRE.run('u1', { questions: six });
    expect(setPendingQuestionnaire).toHaveBeenCalledTimes(1);
    expect(out).toContain('6 questions');
  });

  it('normalises the id and trims the words, so a stray capital is not a new question', async () => {
    await SEND_QUESTIONNAIRE.run('u1', {
      questions: [
        { id: '  Days_Free ', label: '  Which days? ', kind: 'text' },
        { id: 'note', label: 'Anything else?', kind: 'TEXT' },
      ],
    });
    expect(pointer().questions).toEqual([
      { id: 'days_free', label: 'Which days?', kind: 'text' },
      { id: 'note', label: 'Anything else?', kind: 'text' },
    ]);
  });

  it('drops options from a typed question — buttons the card will never draw', async () => {
    await SEND_QUESTIONNAIRE.run('u1', {
      questions: [
        { id: 'note', label: 'Anything else?', kind: 'text', options: ['a', 'b'] },
        { id: 'mins', label: 'How long?', kind: 'number', options: ['10'] },
      ],
    });
    for (const q of pointer().questions as Array<Record<string, unknown>>) {
      expect(q).not.toHaveProperty('options');
    }
  });

  it('folds duplicate options inside one question rather than showing the same button twice', async () => {
    await SEND_QUESTIONNAIRE.run('u1', {
      questions: [
        { id: 'where', label: 'Where?', kind: 'choice', options: ['Home', 'home ', 'Gym'] },
        { id: 'note', label: 'Anything else?', kind: 'text' },
      ],
    });
    expect((pointer().questions as Array<{ options?: string[] }>)[0]!.options).toEqual(['Home', 'Gym']);
  });

  it('says what is true and nothing about what to say next', async () => {
    const out = await SEND_QUESTIONNAIRE.run('u1', { questions: TWO });
    expect(out).toBe(
      'A questionnaire with 2 questions is on their screen. Their answers arrive as their own message when they ' +
        'send it; nothing is recorded until then.',
    );
    // Facts, not picks (owner red line 2026-09-03): no instruction about tone, length, or offers.
    expect(out).not.toMatch(/\bsay\b|\bkeep it\b|\btell them\b|\boffer\b|\bone short line\b/i);
  });

  it('does not claim the card is up when the write failed', async () => {
    vi.mocked(setPendingQuestionnaire).mockRejectedValueOnce(new Error('down'));
    const out = await SEND_QUESTIONNAIRE.run('u1', { questions: TWO });
    expect(out).toMatch(/did NOT go up/);
    expect(out).toMatch(/do not say there is/);
    expect(out).not.toMatch(/\bask them\b|\binstead\b/i);
  });
});

/**
 * Refuse, never truncate. A seventh question dropped quietly is one the coach believes she asked
 * and will wait forever for an answer to — so an over-long set fails whole, with the count.
 */
describe('send_questionnaire — the set it refuses', () => {
  const table: Array<[what: string, questions: unknown, saysAbout: RegExp]> = [
    ['no questions at all', undefined, /between 2 and 6/],
    ['an empty list', [], /0 questions were given/],
    ['one question', [TWO[0]], /1 question was given/],
    [
      'seven questions',
      Array.from({ length: 7 }, (_, i) => ({ id: `q_${i}`, label: `Question ${i}?`, kind: 'text' })),
      /7 questions were given/,
    ],
    ['questions that are not a list', { id: 'a' }, /between 2 and 6/],
    ['an id with spaces in it', [{ id: 'days free', label: 'Which days?', kind: 'text' }, TWO[1]], /"id"/],
    ['an id starting with a digit', [{ id: '1st', label: 'Which days?', kind: 'text' }, TWO[1]], /"id"/],
    ['a missing id', [{ label: 'Which days?', kind: 'text' }, TWO[1]], /"id"/],
    ['two questions sharing an id', [TWO[0], { ...TWO[1], id: 'days_free' }], /share the id "days_free"/],
    ['a question with no words in it', [{ id: 'days_free', kind: 'text' }, TWO[1]], /no "label"/],
    ['a label longer than a question', [{ id: 'q', label: 'x'.repeat(121), kind: 'text' }, TWO[1]], /121 characters/],
    ['a kind no card can draw', [{ id: 'q', label: 'Which days?', kind: 'slider' }, TWO[1]], /"slider"/],
    ['a missing kind', [{ id: 'q', label: 'Which days?' }, TWO[1]], /kinds are text, number, choice, multi/],
    [
      'a choice with one option',
      [{ id: 'q', label: 'Where?', kind: 'choice', options: ['Home'] }, TWO[1]],
      /1 usable option/,
    ],
    ['a choice with no options', [{ id: 'q', label: 'Where?', kind: 'choice' }, TWO[1]], /0 usable options/],
    [
      'a multi with nine options',
      [{ id: 'q', label: 'Where?', kind: 'multi', options: 'abcdefghi'.split('') }, TWO[1]],
      /9 usable options/,
    ],
    [
      'a choice whose options are all the same word',
      [{ id: 'q', label: 'Where?', kind: 'choice', options: ['Home', 'home'] }, TWO[1]],
      /1 usable option/,
    ],
  ];

  for (const [what, questions, saysAbout] of table) {
    it(`puts nothing up for ${what}, and says why`, async () => {
      const out = await SEND_QUESTIONNAIRE.run('u1', questions === undefined ? {} : { questions });
      expect(setPendingQuestionnaire).not.toHaveBeenCalled();
      expect(out).toMatch(/^Nothing is on their screen:/);
      expect(out).toMatch(saysAbout);
      // Facts, not picks: a refusal reports the fault and stops. What to do instead is hers.
      expect(out).not.toMatch(/\bask them\b|\bcall this again\b|\bin chat\b/i);
    });
  }

  it('names which question is wrong when only one of them is', async () => {
    const out = await SEND_QUESTIONNAIRE.run('u1', {
      questions: [TWO[0], TWO[1], { id: 'where', label: 'Where?', kind: 'choice', options: ['Home'] }],
    });
    expect(out).toContain('question 3');
  });
});

/**
 * The harness audit (retrieval/description-audit.test.ts) reads only the tools DECLARED every turn,
 * and this one is in the tail — so the same rules are asserted here or they are asserted nowhere.
 */
describe('send_questionnaire — the description the harness would audit', () => {
  const d = SEND_QUESTIONNAIRE.description;

  it('fits the action bound', () => {
    expect(d.length, `description is ${d.length} chars`).toBeLessThanOrEqual(800);
  });

  it('says when to Use it, and when to do something else instead', () => {
    expect(d).toMatch(/\bUse\b/);
    expect(d).toMatch(/ask in chat instead/);
  });

  it('states its gate — that it writes nothing until they send the card', () => {
    expect(d).toMatch(/This writes nothing/);
    expect(d).toMatch(/nothing is on file until then/);
  });

  it('teaches every declared parameter with a quoted example', () => {
    for (const key of Object.keys(SEND_QUESTIONNAIRE.parameters.properties)) {
      expect(d, `"${key}" is declared but never taught`).toContain(`"${key}"`);
    }
    for (const field of ['"id"', '"label"', '"kind"', '"options"', '"hint"']) {
      expect(d, `${field} is part of a question and is never taught`).toContain(field);
    }
  });

  it('names every kind the card can draw, so she cannot ask for one it cannot', () => {
    for (const kind of ['text', 'number', 'choice', 'multi']) expect(d).toContain(kind);
  });

  it('says what omitting the one optional field does', () => {
    expect(d).toMatch(/"hint" is optional/);
  });

  it('uses no word that means something only to this codebase', () => {
    const banned = [/\boccurrences?\b/i, /\bcaptured?\b/i, /\bjsonb?\b/i, /\bbroker\b/i, /\bpointer\b/i];
    expect(banned.filter((re) => re.test(d))).toEqual([]);
  });
});

/**
 * The migration is written here and applied by hand at merge — so the only thing that can check it
 * before then is this. Additive, idempotent, and nothing else.
 */
describe('migration 0057', () => {
  const file = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../migrations/cadence/0057_pending_questionnaire.sql',
  );
  const sqlText = readFileSync(file, 'utf8');

  it('adds the one column, idempotently', () => {
    expect(sqlText).toMatch(
      /alter table cadence\.users\s*\n?\s*add column if not exists pending_questionnaire jsonb;/i,
    );
  });

  it('touches nothing else — no drop, no delete, no rewrite of existing rows', () => {
    expect(sqlText).not.toMatch(/\bdrop\b/i);
    expect(sqlText).not.toMatch(/\bdelete\b/i);
    expect(sqlText).not.toMatch(/\bupdate\s+cadence\./i);
  });
});
