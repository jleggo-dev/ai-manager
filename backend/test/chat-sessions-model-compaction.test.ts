/**
 * The two model functions compaction leans on (HARNESS-V3 P1b), checked against a fake query
 * builder that records every call (no database):
 *  - `listChatMessages` reads a page at a time. Supabase returns at most 1,000 rows per request
 *    and says nothing, and in ascending order the rows it drops are the NEWEST (finding I).
 *  - `updateChatSessionIfMarkUnchanged` filters on the mark the plan was built from (finding E).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Call = [string, ...unknown[]];
const q = vi.hoisted(() => ({ calls: [] as Call[], result: (_calls: Call[]): unknown => ({ data: [], error: null }) }));

vi.mock('../src/db/tenant.ts', () => {
  const builder = (calls: Call[]): unknown =>
    new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === 'then') {
            const done = q.result(calls);
            return (resolve: (v: unknown) => void) => resolve(done);
          }
          return (...args: unknown[]) => {
            calls.push([prop, ...args]);
            q.calls.push([prop, ...args]);
            return builder(calls);
          };
        },
      },
    );
  return {
    tenantFrom: vi.fn((table: string) => builder([['from', table]])),
    tenantInsertPayload: vi.fn((row: object) => row),
    requireWorkspaceId: vi.fn(() => 'w'),
  };
});
vi.mock('../src/db/service-supabase.ts', () => ({ getServiceSupabase: vi.fn() }));

const { listChatMessages, updateChatSessionIfMarkUnchanged } = await import('../src/models/chat-sessions.ts');

beforeEach(() => {
  q.calls = [];
});

describe('listChatMessages', () => {
  it('reads past the 1,000-row page, so the newest rows are not the ones lost', async () => {
    const total = 2_345;
    q.result = (calls) => {
      const range = calls.find((c) => c[0] === 'range') as [string, number, number];
      const rows = Array.from({ length: total }, (_, i) => ({ id: `m${i}` })).slice(range[1], range[2] + 1);
      return { data: rows, error: null };
    };
    const rows = await listChatMessages('s1');
    expect(rows).toHaveLength(total);
    expect(rows.at(-1)?.id).toBe(`m${total - 1}`);
    expect(q.calls.filter((c) => c[0] === 'range')).toEqual([
      ['range', 0, 999],
      ['range', 1000, 1999],
      ['range', 2000, 2999],
    ]);
  });

  it('a short session is one request', async () => {
    q.result = () => ({ data: [{ id: 'a' }, { id: 'b' }], error: null });
    expect(await listChatMessages('s1')).toHaveLength(2);
    expect(q.calls.filter((c) => c[0] === 'range')).toHaveLength(1);
  });
});

describe('updateChatSessionIfMarkUnchanged', () => {
  it.each([
    ['no mark yet: `is null`', null, ['is', 'summary_through_at', null]],
    [
      'a mark: equality on it',
      '2026-10-31T10:00:05.123456+00:00',
      ['eq', 'summary_through_at', '2026-10-31T10:00:05.123456+00:00'],
    ],
  ])('%s', async (_name, mark, filter) => {
    q.result = () => ({ data: { id: 's1' }, error: null });
    await updateChatSessionIfMarkUnchanged('s1', { session_summary: 'x' }, mark);
    expect(q.calls).toContainEqual(filter);
    expect(q.calls).toContainEqual(['eq', 'id', 's1']);
  });

  it('a miss (someone moved the mark) returns null, not an error', async () => {
    q.result = () => ({ data: null, error: null });
    await expect(updateChatSessionIfMarkUnchanged('s1', { session_summary: 'x' }, null)).resolves.toBeNull();
  });
});
