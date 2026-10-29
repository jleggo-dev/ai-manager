/**
 * The Usual shelf's paging (owner, 2026-10-29: "endless scroll, in order of recent, but build as
 * a paginated list"). And the bug that hid the owner's whole breakfast history behind one latte:
 * a failed read must THROW, never come back as an empty list the cache then keeps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { renderHookWithQuery } from '../../test/withQuery.tsx';
import { getUsualAtSlot } from '../../lib/api/foods-usual.ts';
import { queryKeys } from '../../lib/query/keys.ts';

const row = (id: string) => ({ kind: 'food', id, name: id, kcal: 10, count: 1, last_date: '2026-09-09' });
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('getUsualAtSlot — one page', () => {
  it('sends the cursor and hands back the next one', async () => {
    fetchMock.mockResolvedValue(ok({ items: [row('milk')], next_cursor: '30' }));
    const page = await getUsualAtSlot('breakfast', 30, '0');
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/meal=breakfast&limit=30&cursor=0/);
    expect(page.items.map((i) => i.id)).toEqual(['milk']);
    expect(page.nextCursor).toBe('30');
  });

  it('a first page sends no cursor, and a missing next_cursor means the list is done', async () => {
    fetchMock.mockResolvedValue(ok({ items: [] }));
    const page = await getUsualAtSlot('breakfast');
    expect(String(fetchMock.mock.calls[0]![0])).not.toMatch(/cursor=/);
    expect(page.nextCursor).toBeNull();
  });

  it('THROWS on a failed read — never an empty list that reads as "nothing logged here"', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as Response);
    await expect(getUsualAtSlot('breakfast')).rejects.toThrow(/500/);
  });
});

describe('useUsualAtSlot — the endless shelf', () => {
  it('appends each page in order and stops when the server says done', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ items: [row('banana'), row('milk')], next_cursor: '2' }))
      .mockResolvedValueOnce(ok({ items: [row('skyr')], next_cursor: null }));
    const { useUsualAtSlot } = await import('./useUsualAtSlot.ts');
    const { result } = renderHookWithQuery(() => useUsualAtSlot('breakfast'));

    await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual(['banana', 'milk']));
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual(['banana', 'milk', 'skyr']));
    expect(result.current.hasMore).toBe(false);
    expect(String(fetchMock.mock.calls[1]![0])).toMatch(/cursor=2/);

    // Done means done: asking again fetches nothing.
    act(() => result.current.loadMore());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a failed first read caches NOTHING — the next launch cannot paint an empty shelf from it', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as Response);
    const { useUsualAtSlot } = await import('./useUsualAtSlot.ts');
    const { result, client } = renderHookWithQuery(() => useUsualAtSlot('breakfast'));
    await waitFor(() => expect(client.getQueryState(queryKeys.usualAtSlot.paged('breakfast'))?.status).toBe('error'));
    expect(client.getQueryData(queryKeys.usualAtSlot.paged('breakfast'))).toBeUndefined();
    expect(result.current.items).toEqual([]);
  });
});
