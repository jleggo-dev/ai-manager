/**
 * Seeding a collection — the expand and the confirm.
 *
 * Two properties carry the feature and neither throws when it breaks, so both are pinned here:
 *
 *  1. **A broken read must not read as an empty book.** "Suzuki Book 2 has nothing in it" is a
 *     claim about the book; "I could not look it up" is a claim about us. The 2026-08 Apple
 *     Health bug is the whole reason tool-response.ts exists — a swallowed throw told a user with
 *     thirty workouts that he had none.
 *  2. **A seed writes three standings and never the other two.** `retired` files a piece as
 *     finished that nobody finished; the `learned` verb stamps `learned_at`, so a book confirmed
 *     with it dates sixty crossings to today and the recap says "you learned sixty pieces this
 *     week". Both land silently.
 *
 * The fixture is Suzuki Piano Book 2 with its three minuets in G — the collision that the
 * repertoire's own matcher documents (repertoire-match.ts) — and the assertion is that all twelve
 * pass `isResolvable` together, so nothing the seed offers is a row that can never be found again.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { COLLECTION_KEY, COMPOSER_KEY, RANK_KEY, type RepertoireItem } from '@cadence/shared';

const runJobBySlug = vi.fn();
const listRepertoire = vi.fn();
const upsertRepertoireItem = vi.fn();
const clearPendingSessionsForGoal = vi.fn(async (..._a: unknown[]) => 0);
const stampPracticed = vi.fn(async (..._a: unknown[]) => {});

vi.mock('../ai/aim.ts', () => ({ runJobBySlug: (...a: unknown[]) => runJobBySlug(...a) }));
vi.mock('../config.ts', () => ({
  cadenceConfig: {
    databaseUrl: 'postgresql://mock:mock@mock:5432/mock',
    supabase: { url: '', anonKey: '', serviceRoleKey: '' },
    aim: {},
  },
}));
vi.mock('../repos/repertoire.ts', () => ({
  listRepertoire: (...a: unknown[]) => listRepertoire(...a),
  upsertRepertoireItem: (...a: unknown[]) => upsertRepertoireItem(...a),
  clearPendingSessionsForGoal: (...a: unknown[]) => clearPendingSessionsForGoal(...a),
  stampPracticed: (...a: unknown[]) => stampPracticed(...a),
}));

const { expandCollection, confirmSeed } = await import('./repertoire-seed.ts');
const { isResolvable } = await import('./repertoire-practice.ts');

/** Suzuki Piano Book 2 as the job should hand it back — twelve rows, three minuets in G. */
const BOOK2 = [
  { label: 'Écossaise', composer: 'J.N. Hummel', catalogue: null },
  { label: 'Long, Long Ago', composer: 'T.H. Bayly', catalogue: null },
  { label: 'Little Playmates', composer: 'F.X. Chwatal', catalogue: null },
  { label: 'The Happy Farmer', composer: 'R. Schumann', catalogue: 'Op. 68 No. 10' },
  { label: 'Minuet in G Major, BWV Anh. 114', composer: 'C. Petzold', catalogue: 'BWV Anh. 114' },
  { label: 'Minuet in G Minor, BWV Anh. 115', composer: 'C. Petzold', catalogue: 'BWV Anh. 115' },
  { label: 'Minuet in G Major, BWV Anh. 116', composer: 'C. Petzold', catalogue: 'BWV Anh. 116' },
  { label: 'Minuet in G Major, BWV 822', composer: 'J.S. Bach', catalogue: 'BWV 822' },
  { label: 'Cradle Song', composer: 'F. Schubert', catalogue: 'Op. 98 No. 2' },
  { label: 'Minuet in G Major, WoO 10 No. 2', composer: 'L. van Beethoven', catalogue: 'WoO 10 No. 2' },
  { label: 'Musette in D Major, BWV Anh. 126', composer: 'Anon.', catalogue: 'BWV Anh. 126' },
  { label: 'Chanson', composer: 'Anon.', catalogue: null },
].map((p, i) => ({ ...p, collection: 'Suzuki Piano Book 2', rank: i + 1 }));

const answered = (items: unknown[]) => ({ formatted: JSON.stringify({ items }) });

/** A row as the repo hands one back, so the write path has something with a goal_id to invalidate. */
function row(label: string, goalId: string | null = 'g1'): RepertoireItem {
  return {
    item_id: `i-${label}`,
    user_id: 'u1',
    goal_id: goalId,
    label,
    status: 'known',
    kind: null,
    meta: null,
    started_at: '2026-09-01T00:00:00.000Z',
    learned_at: null,
    last_practiced_at: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listRepertoire.mockResolvedValue([]);
  upsertRepertoireItem.mockImplementation(async (_u: string, item: { label: string }) => ({
    item: row(item.label),
    learnedNow: false,
  }));
});

describe('expandCollection — the twelve rows', () => {
  it('returns the book in order, dense 1-based, with the qualifiers split out of the title', async () => {
    runJobBySlug.mockResolvedValue(answered(BOOK2));
    const res = await expandCollection('u1', 'Suzuki Piano Book 2');

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.candidates).toHaveLength(12);
    expect(res.candidates.map((c) => c.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(res.candidates[4]).toMatchObject({
      label: 'Minuet in G Major, BWV Anh. 114',
      composer: 'C. Petzold',
      collection: 'Suzuki Piano Book 2',
      catalogue: 'BWV Anh. 114',
    });
    expect(runJobBySlug).toHaveBeenCalledWith('u1', 'expand-collection', { collection: 'Suzuki Piano Book 2' });
  });

  it('every one of the twelve is resolvable alongside the other eleven — three minuets in G included', async () => {
    runJobBySlug.mockResolvedValue(answered(BOOK2));
    const res = await expandCollection('u1', 'Suzuki Piano Book 2');
    if (!res.ok) throw new Error('expected ok');

    const all = res.candidates.map((c) => ({ label: c.label }));
    for (const c of res.candidates) expect(isResolvable(all, c.label)).toBe(true);
    expect(res.candidates.filter((c) => c.ambiguous)).toEqual([]);
    // Three rows, not one — the bare title would have collapsed them.
    expect(res.candidates.filter((c) => c.label.startsWith('Minuet in G Major'))).toHaveLength(4);
  });

  it('renumbers rank densely in returned order, whatever the model numbered', async () => {
    runJobBySlug.mockResolvedValue(
      answered([
        { label: 'Second', rank: 9 },
        { label: 'Third', rank: 9 },
        { label: 'First', rank: 'x' },
      ]),
    );
    const res = await expandCollection('u1', 'Anything');
    if (!res.ok) throw new Error('expected ok');
    expect(res.candidates.map((c) => [c.label, c.rank])).toEqual([
      ['Second', 1],
      ['Third', 2],
      ['First', 3],
    ]);
  });

  it('drops empty labels, trims, strips anything URL-shaped, and caps at sixty', async () => {
    runJobBySlug.mockResolvedValue(
      answered([
        { label: '   Gavotte  ', composer: '  J.S. Bach (www.bach.de) ' },
        { label: '   ' },
        { label: 'https://example.com/piece' },
        { label: 'Sarabande https://example.com/x', collection: 'Suzuki Piano Book 2' },
        ...Array.from({ length: 70 }, (_, i) => ({ label: `Filler ${i}` })),
      ]),
    );
    const res = await expandCollection('u1', 'Anything');
    if (!res.ok) throw new Error('expected ok');

    expect(res.candidates).toHaveLength(60);
    expect(res.candidates[0]).toMatchObject({ label: 'Gavotte', composer: 'J.S. Bach' });
    expect(res.candidates.map((c) => c.label)).not.toContain('');
    expect(res.candidates[1]).toMatchObject({ label: 'Sarabande' });
    expect(JSON.stringify(res.candidates)).not.toMatch(/https?:|www\./);
  });

  it('marks a candidate ambiguous when another candidate answers to the same title', async () => {
    runJobBySlug.mockResolvedValue(answered([{ label: 'Minuet in G Major' }, { label: 'Minuet in G Major, BWV 822' }]));
    const res = await expandCollection('u1', 'Anything');
    if (!res.ok) throw new Error('expected ok');
    expect(res.candidates.map((c) => [c.label, c.ambiguous])).toEqual([
      ['Minuet in G Major', true],
      ['Minuet in G Major, BWV 822', false],
    ]);
  });

  it('marks BOTH of two candidates that carry the very same title — they would land as one row', async () => {
    runJobBySlug.mockResolvedValue(answered([{ label: 'Gavotte' }, { label: 'gavotte' }]));
    const res = await expandCollection('u1', 'Anything');
    if (!res.ok) throw new Error('expected ok');
    expect(res.candidates.map((c) => c.ambiguous)).toEqual([true, true]);
  });

  it('marks a candidate the USER’s shelf already makes ambiguous', async () => {
    listRepertoire.mockResolvedValue([row('Minuet in G Major, BWV 822'), row('Minuet in G Major (Petzold)')]);
    runJobBySlug.mockResolvedValue(answered([{ label: 'Minuet in G Major' }, { label: 'Chanson' }]));
    const res = await expandCollection('u1', 'Anything');
    if (!res.ok) throw new Error('expected ok');
    expect(res.candidates.map((c) => [c.label, c.ambiguous])).toEqual([
      ['Minuet in G Major', true],
      ['Chanson', false],
    ]);
  });

  it('an unknown collection is an EMPTY list and still ok — nothing found, not a fault', async () => {
    runJobBySlug.mockResolvedValue(answered([]));
    const res = await expandCollection('u1', 'A book nobody has heard of');
    // `here_rank` is part of the shape now (P7) and is null on every path the person's own
    // door takes — nothing was heard, so there is nothing to pre-mark.
    expect(res).toEqual({ ok: true, collection: 'A book nobody has heard of', candidates: [], here_rank: null });
  });

  it('a job that throws is a FAULT, never an empty book', async () => {
    runJobBySlug.mockRejectedValue(new Error('provider blew up'));
    const res = await expandCollection('u1', 'Suzuki Piano Book 2');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.fault).toMatch(/fault on our side/i);
    expect(res.fault).not.toMatch(/nothing found|no pieces/i);
  });

  it('output that will not parse is a fault, not zero pieces', async () => {
    runJobBySlug.mockResolvedValue({ raw: 'I am terribly sorry, but' });
    const res = await expandCollection('u1', 'Suzuki Piano Book 2');
    expect(res.ok).toBe(false);
  });

  it('output with no items array is a fault', async () => {
    runJobBySlug.mockResolvedValue({ formatted: JSON.stringify({ pieces: [] }) });
    const res = await expandCollection('u1', 'Suzuki Piano Book 2');
    expect(res.ok).toBe(false);
  });

  it('a failed shelf read is a fault, and spends no model call', async () => {
    listRepertoire.mockRejectedValue(new Error('db down'));
    const res = await expandCollection('u1', 'Suzuki Piano Book 2');
    expect(res.ok).toBe(false);
    expect(runJobBySlug).not.toHaveBeenCalled();
  });
});

describe('confirmSeed — what actually gets written', () => {
  const rows = [
    { label: 'Écossaise', composer: 'J.N. Hummel', collection: 'Suzuki Piano Book 2', rank: 1, status: 'known' },
    { label: 'Long, Long Ago', composer: 'T.H. Bayly', collection: 'Suzuki Piano Book 2', rank: 2, status: 'working' },
    { label: 'Chanson', composer: 'Anon.', collection: 'Suzuki Piano Book 2', rank: 3, status: 'queued' },
  ] as const;

  it('writes every confirmed row with its qualifiers in meta, under the goal, and reports them', async () => {
    const res = await confirmSeed('u1', [...rows], 'g1');
    expect(res).toEqual({
      ok: true,
      written: 3,
      labels: ['Écossaise', 'Long, Long Ago', 'Chanson'],
      refused: [],
    });
    expect(upsertRepertoireItem).toHaveBeenCalledTimes(3);
    const [, first] = upsertRepertoireItem.mock.calls[0] as [string, Record<string, unknown>];
    expect(first).toMatchObject({ label: 'Écossaise', status: 'known', goal_id: 'g1' });
    expect(first.meta).toEqual({
      [COMPOSER_KEY]: 'J.N. Hummel',
      [COLLECTION_KEY]: 'Suzuki Piano Book 2',
      [RANK_KEY]: 1,
    });
  });

  it('never stamps a crossing — a backfilled book invents no anniversaries', async () => {
    await confirmSeed('u1', [...rows], 'g1');
    for (const call of upsertRepertoireItem.mock.calls) {
      expect((call[1] as { markLearned?: boolean }).markLearned).toBeFalsy();
    }
  });

  it('writes working, known and queued only — a retired or learned row is dropped', async () => {
    const res = await confirmSeed('u1', [
      { label: 'Chanson', status: 'queued' },
      { label: 'Gavotte', status: 'retired' } as unknown as (typeof rows)[number],
      { label: 'Musette', status: 'learned' } as unknown as (typeof rows)[number],
    ]);
    expect(res).toMatchObject({ ok: true, written: 1, labels: ['Chanson'] });
    const written = upsertRepertoireItem.mock.calls.map((c) => (c[1] as { status: string }).status);
    expect(written).toEqual(['queued']);
  });

  it('resolves each label onto the row already on file, so an accent variant is one piece', async () => {
    listRepertoire.mockResolvedValue([row('Écossaise')]);
    await confirmSeed('u1', [{ label: 'Ecossaise', status: 'known' }]);
    const [, first] = upsertRepertoireItem.mock.calls[0] as [string, { label: string }];
    expect(first.label).toBe('Écossaise');
  });

  // The ruling (supervisor, 2026-09-02): the seed applies `update_repertoire`'s own gate. A row
  // whose title two pieces answer to exists and is permanently unfindable — it reads as a record
  // and behaves as a hole — so it is refused and named, never written and never silently dropped.
  it('refuses BOTH rows that carry one name, names them, and writes the rest', async () => {
    const res = await confirmSeed('u1', [
      { label: 'Gavotte', status: 'known' },
      { label: 'gavotte', status: 'queued' },
      { label: 'Chanson', status: 'queued' },
    ]);
    expect(res).toMatchObject({ ok: true, written: 1, labels: ['Chanson'] });
    if (!res.ok) return;
    expect(res.refused.map((r) => r.label)).toEqual(['Gavotte', 'gavotte']);
    for (const r of res.refused) expect(r.reason).toMatch(/same name/i);
    expect(upsertRepertoireItem).toHaveBeenCalledTimes(1);
    expect((upsertRepertoireItem.mock.calls[0]![1] as { label: string }).label).toBe('Chanson');
  });

  it('refuses an accent-variant duplicate too — lower(label) would not have caught it', async () => {
    const res = await confirmSeed('u1', [
      { label: 'Écossaise', status: 'known' },
      { label: 'Ecossaise', status: 'queued' },
    ]);
    expect(res).toMatchObject({ ok: true, written: 0 });
    if (!res.ok) return;
    expect(res.refused.map((r) => r.label)).toEqual(['Écossaise', 'Ecossaise']);
    expect(upsertRepertoireItem).not.toHaveBeenCalled();
  });

  it('refuses a title the shelf already makes unfindable, names what it collides with, writes the rest', async () => {
    listRepertoire.mockResolvedValue([row('Minuet in G Major, BWV 822'), row('Minuet in G Major (Petzold)')]);
    const res = await confirmSeed('u1', [
      { label: 'Minuet in G Major', status: 'working' },
      { label: 'Chanson', status: 'queued' },
    ]);
    expect(res).toMatchObject({ ok: true, written: 1, labels: ['Chanson'] });
    if (!res.ok) return;
    expect(res.refused).toHaveLength(1);
    expect(res.refused[0]!.label).toBe('Minuet in G Major');
    expect(res.refused[0]!.reason).toMatch(/Minuet in G Major, BWV 822/);
    expect(res.refused[0]!.reason).toMatch(/composer|catalogue/i);
    const written = upsertRepertoireItem.mock.calls.map((c) => (c[1] as { label: string }).label);
    expect(written).toEqual(['Chanson']);
  });

  it('a batch that is entirely refused writes nothing and reports every label', async () => {
    const res = await confirmSeed('u1', [
      { label: 'Gavotte', status: 'known' },
      { label: 'Gavotte', status: 'queued' },
    ]);
    expect(res).toMatchObject({ ok: true, written: 0, labels: [] });
    if (!res.ok) return;
    expect(res.refused).toHaveLength(2);
    expect(upsertRepertoireItem).not.toHaveBeenCalled();
  });

  it('takes no goal at all — a piece someone just wants kept', async () => {
    await confirmSeed('u1', [{ label: 'Chanson', status: 'queued' }], null);
    const [, first] = upsertRepertoireItem.mock.calls[0] as [string, { goal_id: string | null }];
    expect(first.goal_id).toBeNull();
  });

  it('drops the goal’s cached sessions, so the next prescription sees the new shelf', async () => {
    await confirmSeed('u1', [...rows], 'g1');
    expect(clearPendingSessionsForGoal).toHaveBeenCalledWith('u1', 'g1');
  });

  it('a failed shelf read writes NOTHING and says it is a fault', async () => {
    listRepertoire.mockRejectedValue(new Error('db down'));
    const res = await confirmSeed('u1', [...rows], 'g1');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.fault).toMatch(/fault on our side/i);
    expect(upsertRepertoireItem).not.toHaveBeenCalled();
  });

  it('an empty confirm writes nothing and reports zero', async () => {
    const res = await confirmSeed('u1', [], 'g1');
    expect(res).toEqual({ ok: true, written: 0, labels: [], refused: [] });
    expect(upsertRepertoireItem).not.toHaveBeenCalled();
  });
});
