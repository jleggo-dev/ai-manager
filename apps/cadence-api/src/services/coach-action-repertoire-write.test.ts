/**
 * `update_repertoire`'s WRITE path — what actually reaches the row.
 *
 * Own file rather than more of coach-action-repertoire.test.ts: that one is a pure table over
 * `STATUS_OF` and the description string, with no repo mocked at all, and a `vi.mock` added there
 * would pull a database boundary into a test that deliberately has none.
 *
 * What is pinned here is the field the owner added on 2026-09-03 — the user's own words for which
 * one an item is. It rides `qualifierMeta` like every other qualifier, which matters because the
 * repo MERGES meta: written any other way, a description saved tonight would erase the tempo they
 * settled on last month, and nothing would throw.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const listRepertoire = vi.fn(async (): Promise<unknown[]> => []);
const upsertRepertoireItem = vi.fn();
const insertGoalEvent = vi.fn(async () => ({}));
const invalidateSessionsFor = vi.fn(async (..._a: unknown[]) => {});
const resolveCollectionByName = vi.fn();

vi.mock('../repos/repertoire.ts', () => ({
  listRepertoire: (...a: unknown[]) => listRepertoire(...(a as [])),
  upsertRepertoireItem: (...a: unknown[]) => upsertRepertoireItem(...a),
}));
// The collections repo is mocked, not the SQL. `collectionKey` stays real — a second spelling of
// "which names are the same name" in a test is exactly the drift the shared rule exists to stop.
const actualCollections = await vi.importActual<typeof import('../repos/repertoire-collections.ts')>(
  '../repos/repertoire-collections.ts',
);
vi.mock('../repos/repertoire-collections.ts', () => ({
  collectionKey: (name: string) => actualCollections.collectionKey(name),
  resolveCollectionByName: (...a: unknown[]) => resolveCollectionByName(...a),
}));
vi.mock('../repos/goals.ts', () => ({ listGoals: vi.fn(async () => []) }));
vi.mock('../repos/goal-events.ts', () => ({ insertGoalEvent: (...a: unknown[]) => insertGoalEvent(...(a as [])) }));
vi.mock('./repertoire-practice.ts', async () => {
  const actual = await vi.importActual<typeof import('./repertoire-practice.ts')>('./repertoire-practice.ts');
  return { ...actual, invalidateSessionsFor: (...a: unknown[]) => invalidateSessionsFor(...a) };
});

const { UPDATE_REPERTOIRE } = await import('./coach-action-repertoire.ts');

/** The meta the repo was handed for the first item written. */
const metaOfFirstWrite = (): Record<string, unknown> | undefined =>
  (upsertRepertoireItem.mock.calls[0]?.[1] as { meta?: Record<string, unknown> })?.meta;

/** The collection each write was filed into, in call order. */
const collectionIdsWritten = (): Array<string | null | undefined> =>
  upsertRepertoireItem.mock.calls.map((c) => (c[1] as { collection_id?: string | null }).collection_id);

beforeEach(() => {
  vi.clearAllMocks();
  listRepertoire.mockResolvedValue([]);
  resolveCollectionByName.mockImplementation(async (_u: string, name: string) => ({
    collection_id: `c-${actualCollections.collectionKey(name)}`,
    name,
    item_count: 0,
  }));
  upsertRepertoireItem.mockImplementation(async (_u: string, item: { label: string }) => ({
    item: { item_id: 'i-1', goal_id: null, label: item.label, status: 'working' },
    learnedNow: false,
  }));
});

describe('update_repertoire writes the description she was given', () => {
  it('stores it under the qualifier key, through the same patch every other qualifier uses', async () => {
    await UPDATE_REPERTOIRE.run('u1', {
      items: [{ label: 'Minuet in G Major, BWV 822', status: 'working', description: 'the fast one my teacher set' }],
    });
    expect(metaOfFirstWrite()).toEqual({ description: 'the fast one my teacher set' });
  });

  it('sends no meta at all when she gave none — an absent field must not blank what is on file', async () => {
    await UPDATE_REPERTOIRE.run('u1', { items: [{ label: 'Arietta', status: 'known' }] });
    expect(metaOfFirstWrite()).toBeUndefined();
  });

  it.each([['   '], [''], [42], [null]])('ignores a description of %j rather than storing it', async (description) => {
    await UPDATE_REPERTOIRE.run('u1', { items: [{ label: 'Arietta', status: 'known', description }] });
    expect(metaOfFirstWrite()).toBeUndefined();
  });

  it('trims and bounds it at the description cap, like every other stored qualifier', async () => {
    const long = 'x'.repeat(300);
    await UPDATE_REPERTOIRE.run('u1', { items: [{ label: 'Arietta', status: 'known', description: `  ${long}  ` }] });
    expect(metaOfFirstWrite()?.description).toBe(long.slice(0, 240));
  });

  it('writes one item its own description and leaves the other alone', async () => {
    await UPDATE_REPERTOIRE.run('u1', {
      items: [
        { label: 'Heian Shodan', status: 'known', description: 'the first kata' },
        { label: 'Heian Nidan', status: 'queued' },
      ],
    });
    const metas = upsertRepertoireItem.mock.calls.map((c) => (c[1] as { meta?: unknown }).meta);
    expect(metas).toEqual([{ description: 'the first kata' }, undefined]);
  });
});

/**
 * The collection she names (P11, migration 0056). She writes words — "the Écossaise from Suzuki
 * Book 2" — and the store owns ids, so the write path resolves the name to a row and files the item
 * by its key.
 *
 * Every case here fails silently: a name resolved twice makes two collections out of one, a name
 * never resolved leaves the piece ungrouped with nothing on screen to say so, and a name written
 * into `meta` would be a field nothing reads any more.
 */
describe('update_repertoire files an item into the collection she named', () => {
  it('resolves the name and writes the id, never the name', async () => {
    await UPDATE_REPERTOIRE.run('u1', {
      items: [{ label: 'Écossaise', status: 'known', collection: 'Suzuki Book 2' }],
    });
    expect(resolveCollectionByName).toHaveBeenCalledWith('u1', 'Suzuki Book 2');
    expect(collectionIdsWritten()).toEqual(['c-suzuki book 2']);
    expect(metaOfFirstWrite()).toBeUndefined();
  });

  it('resolves one name ONCE for a whole call, however many items carry it', async () => {
    await UPDATE_REPERTOIRE.run('u1', {
      items: [
        { label: 'Écossaise', status: 'known', collection: 'Suzuki Book 2' },
        { label: 'Chanson', status: 'queued', collection: 'suzuki book 2' },
      ],
    });
    expect(resolveCollectionByName).toHaveBeenCalledTimes(1);
    expect(collectionIdsWritten()).toEqual(['c-suzuki book 2', 'c-suzuki book 2']);
  });

  it('files two genuinely different names into two collections', async () => {
    await UPDATE_REPERTOIRE.run('u1', {
      items: [
        { label: 'Écossaise', status: 'known', collection: 'Suzuki Book 2' },
        { label: 'Heian Shodan', status: 'queued', collection: 'Shotokan kata syllabus' },
      ],
    });
    expect(collectionIdsWritten()).toEqual(['c-suzuki book 2', 'c-shotokan kata syllabus']);
  });

  /** Omitted means "leave it where it is": the repo coalesces a null onto the row's existing
   *  collection, so a bare re-mention cannot lift a piece out of the book someone put it in. */
  it.each([[undefined], ['   '], [''], [42], [null]])(
    'writes no collection for %j, so an existing one is left alone',
    async (collection) => {
      await UPDATE_REPERTOIRE.run('u1', { items: [{ label: 'Arietta', status: 'known', collection }] });
      expect(resolveCollectionByName).not.toHaveBeenCalled();
      expect(collectionIdsWritten()).toEqual([null]);
    },
  );

  it('writes one item its own collection and leaves the other ungrouped', async () => {
    await UPDATE_REPERTOIRE.run('u1', {
      items: [
        { label: 'Écossaise', status: 'known', collection: 'Suzuki Book 2' },
        { label: 'Arietta', status: 'queued' },
      ],
    });
    expect(collectionIdsWritten()).toEqual(['c-suzuki book 2', null]);
  });

  /** A failed resolve writes NOTHING and says so. Writing the pieces ungrouped instead would claim
   *  an effect the call did not produce (TOOL-HARNESS.md §5) — she would tell them it went into
   *  their book, and it would not have. */
  it('reports the fault and writes nothing when the collection cannot be resolved', async () => {
    resolveCollectionByName.mockRejectedValue(new Error('db down'));
    const out = await UPDATE_REPERTOIRE.run('u1', {
      items: [{ label: 'Écossaise', status: 'known', collection: 'Suzuki Book 2' }],
    });
    expect(out).toMatch(/did not write anything/i);
    expect(upsertRepertoireItem).not.toHaveBeenCalled();
  });

  /**
   * The collection is a stated fact for the collision check, exactly as the composer is: the same
   * title in two different books is two items, and neither has to grow a parenthetical to be
   * findable. Without this a second "Minuet in G Major" is refused however clearly it is filed.
   */
  it('lets a differently-filed item share a title with one already on file', async () => {
    listRepertoire.mockResolvedValue([
      {
        item_id: 'i-0',
        label: 'Minuet in G Major',
        status: 'known',
        goal_id: null,
        meta: null,
        collection_name: 'Anna Magdalena Notebook',
      },
    ]);
    await UPDATE_REPERTOIRE.run('u1', {
      items: [{ label: 'Minuet in G Major', status: 'queued', collection: 'Suzuki Book 2' }],
    });
    expect(upsertRepertoireItem).toHaveBeenCalledTimes(1);
    expect(collectionIdsWritten()).toEqual(['c-suzuki book 2']);
  });
});
