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

vi.mock('../repos/repertoire.ts', () => ({
  listRepertoire: (...a: unknown[]) => listRepertoire(...(a as [])),
  upsertRepertoireItem: (...a: unknown[]) => upsertRepertoireItem(...a),
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

beforeEach(() => {
  vi.clearAllMocks();
  listRepertoire.mockResolvedValue([]);
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
