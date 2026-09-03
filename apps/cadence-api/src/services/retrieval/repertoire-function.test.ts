/**
 * `get_repertoire` — the read, and the two parameters that let her reach past the capped group.
 *
 * The context block she is handed every turn shows Learning, Up next and Keeping up in full and the
 * 12 most recently touched Learned items, with the total stated (owner ruling 2026-09-03: *"a
 * 500-piece Learned list should not go to the coach every turn; the total plus the ability to ask
 * for more limits tokens and gives her a more relevant list"*). This tool is the "ask for more".
 *
 * A router, so a table: every standing, the capped default, the uncapped ask, and the near-misses
 * that would fail silently — a `standing` she spelled wrong must read everything rather than
 * nothing, and `all` on its own must not quietly uncap a list she did not ask for.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../repos/repertoire.ts', () => ({ listRepertoire: vi.fn(async () => []) }));

import { listRepertoire } from '../../repos/repertoire.ts';
import { GET_REPERTOIRE, type RepertoireRead } from './repertoire-function.ts';

const row = (label: string, status: string, over: Record<string, unknown> = {}) => ({
  item_id: label,
  user_id: 'u1',
  goal_id: 'g-piano',
  label,
  status,
  kind: 'piece',
  meta: null,
  started_at: '2026-01-01T00:00:00.000Z',
  learned_at: null,
  last_practiced_at: null,
  ...over,
});

/** 3 of each active standing, and 20 finished — enough that the cap of 12 actually bites. */
const SHELF = [
  ...Array.from({ length: 3 }, (_, i) => row(`Learning ${i}`, 'working')),
  ...Array.from({ length: 3 }, (_, i) => row(`Queued ${i}`, 'queued')),
  ...Array.from({ length: 3 }, (_, i) => row(`Known ${i}`, 'known')),
  ...Array.from({ length: 20 }, (_, i) =>
    row(`Done ${String(i).padStart(2, '0')}`, 'retired', {
      learned_at: new Date(Date.UTC(2026, 0, 1) - i * 86_400_000).toISOString(),
    }),
  ),
];

const read = async (params?: Record<string, unknown>): Promise<string> => {
  const result = (await GET_REPERTOIRE.run('u1', params)) as RepertoireRead;
  return GET_REPERTOIRE.render(result);
};

beforeEach(() => {
  vi.mocked(listRepertoire).mockResolvedValue(SHELF as never);
});

describe('get_repertoire — what a bare call returns', () => {
  it('sends the three active standings in full', async () => {
    const out = await read();
    for (const prefix of ['Learning', 'Queued', 'Known']) {
      for (let i = 0; i < 3; i += 1) expect(out).toContain(`${prefix} ${i}`);
    }
  });

  it('caps the finished group at 12 and states the total', async () => {
    const out = await read();
    expect(out).toContain('Learned: 20 items — 12 most recent shown');
    expect(out).toContain('Done 00'); // most recently finished
    expect(out).toContain('Done 11'); // the twelfth
    expect(out).not.toContain('Done 12'); // over the cap
  });

  it('counts every row it read, not every row it printed — the total must not become the count', async () => {
    const result = (await GET_REPERTOIRE.run('u1')) as RepertoireRead;
    expect(GET_REPERTOIRE.rows(result)).toBe(SHELF.length);
  });
});

describe('get_repertoire — standing narrows to one group', () => {
  it.each([
    ['working', 'Learning 0', 'Known 0'],
    ['queued', 'Queued 0', 'Learning 0'],
    ['known', 'Known 0', 'Queued 0'],
    ['retired', 'Done 00', 'Known 0'],
  ])('standing "%s" returns that group and no other', async (standing, present, absent) => {
    const out = await read({ standing });
    expect(out).toContain(present);
    expect(out).not.toContain(absent);
  });

  it('accepts the word however she cased or padded it', async () => {
    expect(await read({ standing: '  Retired ' })).toContain('Done 00');
  });

  /** The near-miss: an unknown word must read EVERYTHING, never nothing. A filter that silently
   *  matched no rows would tell her the shelf is empty — the failure mode the harness bans. */
  it.each([['Keeping up'], ['learned'], [''], [42], [null]])(
    'a standing it does not recognise (%s) reads the whole shelf rather than an empty one',
    async (standing) => {
      const out = await read({ standing } as Record<string, unknown>);
      expect(out).toContain('Learning 0');
      expect(out).toContain('Done 00');
    },
  );
});

describe('get_repertoire — all lifts the cap on the finished group', () => {
  it('returns every finished item, in the same recency order, when asked for them all', async () => {
    const out = await read({ standing: 'retired', all: true });
    expect(out).toContain('Learned: 20 items');
    expect(out).not.toContain('most recent shown');
    for (let i = 0; i < 20; i += 1) expect(out).toContain(`Done ${String(i).padStart(2, '0')}`);
  });

  it('lifts the cap on a whole-shelf read too, leaving the active groups as they were', async () => {
    const out = await read({ all: true });
    expect(out).toContain('Done 19');
    expect(out).toContain('Learning 0');
  });

  it.each([['true'], [1], [null]])('only a real true lifts it — %s does not', async (all) => {
    const out = await read({ standing: 'retired', all } as Record<string, unknown>);
    expect(out).toContain('12 most recent shown');
    expect(out).not.toContain('Done 12');
  });
});

describe('get_repertoire — the description the harness audits', () => {
  const d = GET_REPERTOIRE.description;

  it('fits the read bound', () => {
    expect(d.length, `description is ${d.length} chars`).toBeLessThanOrEqual(520);
  });

  it('says when to Use it and names its sibling', () => {
    expect(d).toMatch(/\bUse\b/);
    expect(d).toContain('get_practice_totals');
    expect(d).toContain('update_repertoire');
  });

  it('teaches both parameters with a quoted worked example', () => {
    expect(d).toContain('"standing"');
    expect(d).toContain('"all"');
  });

  it('says the finished group is capped, so she knows there is more to ask for', () => {
    expect(d).toMatch(/12 most recently finished/);
  });

  /** It no longer returns a pick, so it must not promise one (owner ruling 2026-09-03). */
  it('promises no ranking — the render marks nothing', () => {
    expect(d).not.toMatch(/due next|longest rest|rotation/i);
  });
});
