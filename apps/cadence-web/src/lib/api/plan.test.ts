/**
 * `getRoutineSession` — the shelf's player fetches the full prescription for one lineage
 * separately from the list (whose `steps` are names only). The case worth pinning here is the
 * `ok` distinction: a failed read must read as "I couldn't load it" (`ok: false`), never quietly
 * collapse into "nothing written yet" (`ok: true, session: null`) — the same reasoning
 * `getPendingReplan`'s `ok` flag documents.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { getRoutineSession } from './plan.ts';

describe('getRoutineSession', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns ok:true with the session on a 200 with one cached', async () => {
    const session = {
      blocks: [{ label: 'Main', items: [{ name: 'Warm-up' }] }],
      note: '',
      generated_at: 't',
      version: 1,
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ session }), { status: 200 }));
    const result = await getRoutineSession('c1');
    expect(result).toEqual({ ok: true, session });
  });

  it('returns ok:true with session:null on a 200 for a lineage with nothing cached yet', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ session: null }), { status: 200 }));
    const result = await getRoutineSession('c1');
    expect(result).toEqual({ ok: true, session: null });
  });

  it('returns ok:false — never a false "nothing cached" — on a non-OK response', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    const result = await getRoutineSession('c1');
    expect(result).toEqual({ ok: false, session: null });
  });

  it('returns ok:false on a network failure (thrown fetch)', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const result = await getRoutineSession('c1');
    expect(result).toEqual({ ok: false, session: null });
  });

  it('encodes the commitment id into the path', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ session: null }), { status: 200 }));
    await getRoutineSession('c/1 with spaces');
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain(encodeURIComponent('c/1 with spaces'));
    expect(url.endsWith('/session')).toBe(true);
  });
});
