/**
 * `offer_repertoire_review` — the coach's door into the seed review.
 *
 * What has to be true here is a boundary, not an outcome: she may put the book up and she may say
 * where in it they are, and she may not write a single row. So the load-bearing assertion in this
 * file is a negative one — `upsertRepertoireItem` is never called, on any path, including the ones
 * that fail — and it sits beside the ordinary contract tests (goal match, the pointer's shape, the
 * empty-name refusal, the description bounds the harness audit applies to always-on actions and
 * cannot reach a tail one).
 *
 * The reason the negative matters: this tool's whole value is that the confirm happens on a screen
 * the person is looking at. A version of it that "helpfully" wrote the pieces it had guessed would
 * still pass every positive test in this file and would put sixty invented titles on someone's
 * record.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('../repos/users.ts', () => ({ setPendingRepertoireReview: vi.fn(async () => undefined) }));
vi.mock('../repos/goals.ts', () => ({ listGoals: vi.fn(async () => []) }));
vi.mock('../repos/repertoire.ts', () => ({
  upsertRepertoireItem: vi.fn(async () => ({ item: { label: 'x', status: 'working' }, learnedNow: false })),
  listRepertoire: vi.fn(async () => []),
}));

import { setPendingRepertoireReview } from '../repos/users.ts';
import { listGoals } from '../repos/goals.ts';
import { upsertRepertoireItem } from '../repos/repertoire.ts';
import { OFFER_REPERTOIRE_REVIEW } from './coach-action-offer-repertoire.ts';

const GOALS = [
  { goal_id: 'g-piano', title: 'Practice piano', status: 'active' },
  { goal_id: 'g-run', title: 'Run a half marathon', status: 'active' },
  { goal_id: 'g-old', title: 'Learn the kata', status: 'completed' },
];

/** The one argument every assertion about the pointer reads. */
function pointer(): Record<string, unknown> {
  const call = vi.mocked(setPendingRepertoireReview).mock.calls[0];
  return (call?.[1] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listGoals).mockResolvedValue(GOALS as never);
});

describe('offer_repertoire_review — what it writes', () => {
  it('puts the pointer up with the collection, the piece they named, and the goal it matched', async () => {
    await OFFER_REPERTOIRE_REVIEW.run('u1', {
      collection: 'Suzuki Piano Book 2',
      where_you_are: 'Hungarian Folk Song',
      goal: 'Practice piano',
    });

    expect(setPendingRepertoireReview).toHaveBeenCalledTimes(1);
    expect(vi.mocked(setPendingRepertoireReview).mock.calls[0]![0]).toBe('u1');
    expect(pointer()).toMatchObject({
      collection: 'Suzuki Piano Book 2',
      where_you_are: 'Hungarian Folk Song',
      goal_id: 'g-piano',
    });
    expect(typeof pointer().offered_at).toBe('string');
  });

  it('matches the goal loosely, the way update_repertoire does', async () => {
    await OFFER_REPERTOIRE_REVIEW.run('u1', { collection: 'ABRSM Grade 3', goal: 'piano' });
    expect(pointer().goal_id).toBe('g-piano');
  });

  it('never matches a goal they have finished or dropped', async () => {
    await OFFER_REPERTOIRE_REVIEW.run('u1', { collection: 'Shotokan kata', goal: 'Learn the kata' });
    expect(pointer().goal_id).toBeNull();
  });

  it('still puts the book up when no goal matches, and says the link is missing', async () => {
    const out = await OFFER_REPERTOIRE_REVIEW.run('u1', { collection: 'ABRSM Grade 3', goal: 'wood carving' });
    expect(setPendingRepertoireReview).toHaveBeenCalledTimes(1);
    expect(pointer().goal_id).toBeNull();
    expect(out).toContain('wood carving');
  });

  it('carries no piece when they only named the book', async () => {
    await OFFER_REPERTOIRE_REVIEW.run('u1', { collection: 'Suzuki Piano Book 2' });
    expect(pointer().where_you_are).toBeNull();
  });

  it('reads a goal it could not look up as no link rather than failing the turn', async () => {
    vi.mocked(listGoals).mockRejectedValue(new Error('down'));
    const out = await OFFER_REPERTOIRE_REVIEW.run('u1', { collection: 'Suzuki Piano Book 2', goal: 'Practice piano' });
    expect(setPendingRepertoireReview).toHaveBeenCalledTimes(1);
    expect(pointer().goal_id).toBeNull();
    expect(out).toContain('Suzuki Piano Book 2');
  });
});

describe('offer_repertoire_review — the gate it must never cross', () => {
  const calls: Array<[string, Record<string, unknown>]> = [
    ['a book with a where-you-are', { collection: 'Suzuki Piano Book 2', where_you_are: 'Hungarian Folk Song' }],
    ['a book with a goal', { collection: 'ABRSM Grade 3', goal: 'Practice piano' }],
    ['a book alone', { collection: 'Shotokan kata' }],
    ['nothing at all', {}],
    ['a blank name', { collection: '   ' }],
    ['a name that is not a string', { collection: 12 }],
  ];

  for (const [what, params] of calls) {
    it(`writes no repertoire row for ${what}`, async () => {
      await OFFER_REPERTOIRE_REVIEW.run('u1', params);
      expect(upsertRepertoireItem).not.toHaveBeenCalled();
    });
  }

  it('never claims anything was recorded, added, or saved', async () => {
    const out = await OFFER_REPERTOIRE_REVIEW.run('u1', {
      collection: 'Suzuki Piano Book 2',
      where_you_are: 'Hungarian Folk Song',
    });
    // The CLAIM is the first line — the one sentence a model skimming the result will quote back.
    // Later lines say "do not say anything is recorded", which is the opposite of a claim and must
    // not be read as one, so the word check belongs on the claim line rather than the whole text.
    const claim = out.split('\n')[0]!;
    expect(claim).not.toMatch(/\brecorded\b|\bwritten\b|\bsaved\b|\bstored\b|\badded\b|\bon file now\b/i);
    // And the result says the opposite outright, in words she cannot skim past.
    expect(out).toMatch(/NOTHING is on their file/);
    expect(out).toMatch(/until they confirm/i);
  });

  it('refuses an unnamed collection without putting anything up, and asks for the name', async () => {
    const out = await OFFER_REPERTOIRE_REVIEW.run('u1', { where_you_are: 'Hungarian Folk Song' });
    expect(setPendingRepertoireReview).not.toHaveBeenCalled();
    expect(out).toMatch(/name/i);
  });
});

describe('offer_repertoire_review — what it tells her to say', () => {
  it('tells her to say one line and stop, and not to list the pieces', async () => {
    const out = await OFFER_REPERTOIRE_REVIEW.run('u1', { collection: 'Suzuki Piano Book 2' });
    expect(out).toMatch(/ONE short line/);
    expect(out).toMatch(/STOP/);
    expect(out).toMatch(/do not list the pieces/i);
  });

  it('says the split is pre-marked only when a piece was named', async () => {
    const withPiece = await OFFER_REPERTOIRE_REVIEW.run('u1', {
      collection: 'Suzuki Piano Book 2',
      where_you_are: 'Hungarian Folk Song',
    });
    expect(withPiece).toContain('Hungarian Folk Song');

    vi.clearAllMocks();
    vi.mocked(listGoals).mockResolvedValue(GOALS as never);
    const without = await OFFER_REPERTOIRE_REVIEW.run('u1', { collection: 'Suzuki Piano Book 2' });
    expect(without).toMatch(/nothing is marked|tap the piece/i);
  });
});

/**
 * The harness audit (retrieval/description-audit.test.ts) only reads the tools DECLARED every turn,
 * and this one is in the tail — so the same rules are asserted here or they are asserted nowhere.
 */
describe('offer_repertoire_review — the description the harness would audit', () => {
  const d = OFFER_REPERTOIRE_REVIEW.description;

  it('fits the action bound', () => {
    expect(d.length, `description is ${d.length} chars`).toBeLessThanOrEqual(800);
  });

  it('says when to Use it', () => {
    expect(d).toMatch(/\bUse\b/);
  });

  /**
   * The gate, in plain words (owner ruling 2026-09-03). It read "This does NOT change anything and
   * does NOT add anything to their list" — the harness's own stock phrase, twice. The ruling asked
   * for plain simple language, so it now says what is true in the words a person would use, and
   * says it once: *"This saves nothing: no item goes on their list until they mark it and confirm
   * on that screen."*
   *
   * Still asserted, and this is why: the whole value of this tool is that the confirm happens on a
   * screen the person is looking at. A description that lost the gate would leave a model free to
   * report the collection as recorded.
   */
  it('states its gate — that it saves nothing until they confirm', () => {
    expect(d).toMatch(/This saves nothing/);
    expect(d).toMatch(/until they mark it and confirm/);
  });

  /**
   * Plain words, no metaphor (the same ruling). "Lay a whole book out" was the offending phrase:
   * *"why would Grok or Claude think that a tool about books will help?"* — so the description says
   * what the tool DOES, and names more than one domain.
   */
  it('says what it does in plain words, and names more than one domain', () => {
    expect(d).toMatch(/^Show the user everything in a named collection/);
    expect(d).not.toMatch(/lay .* out/i);
    for (const domain of ['book', 'exam grade', 'grading syllabus', 'reading list', 'poems']) {
      expect(d, `"${domain}" is missing — the description narrows to one kind of user`).toContain(domain);
    }
  });

  it('teaches every declared parameter with a quoted example', () => {
    for (const key of Object.keys(OFFER_REPERTOIRE_REVIEW.parameters.properties)) {
      expect(d, `"${key}" is declared but never taught`).toContain(`"${key}"`);
    }
  });

  it('says what omitting each optional parameter does', () => {
    const props = OFFER_REPERTOIRE_REVIEW.parameters.properties as Record<string, { description?: string }>;
    const required = OFFER_REPERTOIRE_REVIEW.parameters.required ?? [];
    for (const [key, spec] of Object.entries(props)) {
      if (required.includes(key)) continue;
      expect(String(spec.description ?? ''), `${key} does not say what happens without it`).toMatch(
        /default|omit|required for|unless/i,
      );
    }
  });

  it('names its sibling, so a model choosing between the two has the tiebreak', () => {
    expect(d).toContain('update_repertoire');
  });

  it('uses no word that means something only to this codebase', () => {
    const banned = [/\boccurrences?\b/i, /\bwindow\b/i, /\bcaptured?\b/i, /\bjsonb?\b/i, /\bbroker\b/i];
    expect(banned.filter((re) => re.test(d))).toEqual([]);
  });
});

/**
 * The migration is written here and applied by hand at merge — so the only thing that can check it
 * before then is this. Additive, idempotent, and nothing else: a pointer column is not the place
 * for a schema change that could fail half-way.
 */
describe('migration 0055', () => {
  const file = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../migrations/cadence/0055_pending_repertoire_review.sql',
  );
  const sqlText = readFileSync(file, 'utf8');

  it('adds the one column, idempotently', () => {
    expect(sqlText).toMatch(
      /alter table cadence\.users\s*\n?\s*add column if not exists pending_repertoire_review jsonb;/i,
    );
  });

  it('touches nothing else — no drop, no delete, no rewrite of existing rows', () => {
    expect(sqlText).not.toMatch(/\bdrop\b/i);
    expect(sqlText).not.toMatch(/\bdelete\b/i);
    expect(sqlText).not.toMatch(/\bupdate\s+cadence\./i);
  });
});
