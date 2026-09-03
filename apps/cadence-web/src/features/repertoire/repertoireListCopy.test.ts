/**
 * Pure logic for the list screen (P6 "the room") — table-tested per CLAUDE.md's rule for every
 * deterministic router: `orderGroupItems` decides which sort a standing's rows get, and a wrong
 * pick fails silently (the row order looks plausible either way, nothing throws), so it gets a
 * row for every standing, not just the ones with a real sort.
 */
import { describe, it, expect } from 'vitest';
import type { RepertoireItem, RepertoireStatus } from '@cadence/shared';
import { RANK_KEY } from '@cadence/shared';
import {
  buildSecondLine,
  collisionPartnersFor,
  formatRowDate,
  groupInstruction,
  headerCountLine,
  moveQueuedRank,
  orderGroupItems,
  splitUnattached,
} from './repertoireListCopy.ts';

function item(over: Partial<RepertoireItem> = {}): RepertoireItem {
  return {
    item_id: 'it-1',
    user_id: 'u1',
    goal_id: 'g-piano',
    label: 'Clair de lune',
    status: 'known',
    kind: 'piece',
    meta: null,
    started_at: '2026-01-01T00:00:00Z',
    learned_at: null,
    last_practiced_at: null,
    ...over,
  };
}

const daysAgo = (n: number, now = new Date('2026-09-02T12:00:00Z')): string =>
  new Date(now.getTime() - n * 86_400_000).toISOString();

describe('groupInstruction — strips the LLM-prompt wrapper, keeps the words verbatim', () => {
  it('drops the leading name + status parenthetical and the trailing colon', () => {
    const header = 'Learning (status "working") — work these in the learn part of each session; keep it to one or two:';
    expect(groupInstruction(header)).toBe('work these in the learn part of each session; keep it to one or two');
  });

  it('never leaks the schema status word into the derived instruction', () => {
    const header = 'Learned (status "retired") — finished. Count these; never schedule them:';
    expect(groupInstruction(header)).not.toContain('status');
    expect(groupInstruction(header)).not.toContain('retired');
    expect(groupInstruction(header)).toBe('finished. Count these; never schedule them');
  });

  it('is idempotent-safe on a string with no wrapper — returns it unchanged rather than mangling it', () => {
    expect(groupInstruction('plain sentence')).toBe('plain sentence');
  });
});

describe('formatRowDate — relative, then month, then year (coarser than the item screen)', () => {
  const now = new Date('2026-09-02T12:00:00Z');

  it('today and yesterday read as words, not "0 days ago"', () => {
    expect(formatRowDate(daysAgo(0, now), now)).toBe('today');
    expect(formatRowDate(daysAgo(1, now), now)).toBe('yesterday');
  });

  it('under 14 days is "N days ago"', () => {
    expect(formatRowDate(daysAgo(6, now), now)).toBe('6 days ago');
    expect(formatRowDate(daysAgo(13, now), now)).toBe('13 days ago');
  });

  it('14 days and over, same calendar year, is the month alone — no day-of-month', () => {
    expect(formatRowDate(daysAgo(14, now), now)).toBe('Aug');
    expect(formatRowDate('2026-01-05T00:00:00Z', now)).toBe('Jan');
  });

  it('a previous calendar year is the year alone — no month', () => {
    expect(formatRowDate('2025-12-30T00:00:00Z', now)).toBe('2025');
    expect(formatRowDate('2024-04-01T00:00:00Z', now)).toBe('2024');
  });

  it('no date on file is the empty string, never a placeholder', () => {
    expect(formatRowDate(null, now)).toBe('');
    expect(formatRowDate(undefined, now)).toBe('');
    expect(formatRowDate('not a date', now)).toBe('');
  });
});

describe('buildSecondLine — only what is on file, never an empty separator', () => {
  const now = new Date('2026-09-02T12:00:00Z');

  it('composer and collection both on file, joined with the practiced date', () => {
    const i = item({
      meta: { composer: 'Debussy', collection: 'Suite bergamasque' },
      last_practiced_at: daysAgo(1, now),
    });
    expect(buildSecondLine(i, now)).toBe('Debussy · Suite bergamasque · yesterday');
  });

  it('a bare label with nothing on file renders an empty second line, not a lone separator', () => {
    expect(buildSecondLine(item({ meta: null, last_practiced_at: null }), now)).toBe('');
  });

  it('composer only — no dangling " · " where collection or the date would go', () => {
    expect(buildSecondLine(item({ meta: { composer: 'Hummel' }, last_practiced_at: null }), now)).toBe('Hummel');
  });

  it('a retired item with no practice date falls back to when it was learned — "dated" even at rest', () => {
    const i = item({ status: 'retired', last_practiced_at: null, learned_at: daysAgo(400, now) });
    expect(buildSecondLine(i, now)).toBe('2025');
  });

  it('a retired item that WAS practiced again shows that date, not the older learned one', () => {
    const i = item({ status: 'retired', last_practiced_at: daysAgo(2, now), learned_at: daysAgo(400, now) });
    expect(buildSecondLine(i, now)).toBe('2 days ago');
  });

  it('a non-retired item with no practice date never borrows the learned-date fallback', () => {
    const i = item({ status: 'working', last_practiced_at: null, learned_at: daysAgo(10, now) });
    expect(buildSecondLine(i, now)).toBe('');
  });
});

/**
 * `orderGroupItems` — the router deciding which sort a standing's rows get. Table: every standing,
 * positive and near-miss, because a swapped case is silent (Learning drawing rank order instead of
 * server order still renders a plausible list — nothing throws).
 */
describe('orderGroupItems', () => {
  const withRank = (rank: number, label: string) => item({ status: 'queued', label, meta: { [RANK_KEY]: rank } });

  it('queued sorts by rank ascending', () => {
    const items = [withRank(3, 'C'), withRank(1, 'A'), withRank(2, 'B')];
    expect(orderGroupItems('queued', items).map((i) => i.label)).toEqual(['A', 'B', 'C']);
  });

  it('queued items with no rank sort AFTER ranked ones, keeping their own relative order', () => {
    const items = [
      item({ status: 'queued', label: 'no-rank-1', meta: null }),
      withRank(1, 'ranked'),
      item({ status: 'queued', label: 'no-rank-2', meta: null }),
    ];
    expect(orderGroupItems('queued', items).map((i) => i.label)).toEqual(['ranked', 'no-rank-1', 'no-rank-2']);
  });

  it('known sorts by rest (longest-resting first) — the same order pickDueNext reads', () => {
    const items = [
      item({ status: 'known', label: 'A', last_practiced_at: daysAgo(1) }),
      item({ status: 'known', label: 'B', last_practiced_at: daysAgo(19) }),
      item({ status: 'known', label: 'C', last_practiced_at: daysAgo(9) }),
    ];
    expect(orderGroupItems('known', items).map((i) => i.label)).toEqual(['B', 'C', 'A']);
  });

  it.each<RepertoireStatus>(['working', 'retired'])(
    'near-miss: %s is left in server order — it must NOT pick up rank or rest sorting meant for the other two',
    (status) => {
      const items = [item({ status, label: 'Z' }), item({ status, label: 'A' })];
      // Server order (alphabetical from listRepertoire) is preserved as-is: no re-sort applied.
      expect(orderGroupItems(status, items).map((i) => i.label)).toEqual(['Z', 'A']);
    },
  );
});

describe('splitUnattached', () => {
  it("separates goal-linked rows from unattached ones, preserving each side's order", () => {
    const a = item({ item_id: 'a', goal_id: 'g-piano' });
    const b = item({ item_id: 'b', goal_id: null });
    const c = item({ item_id: 'c', goal_id: 'g-piano' });
    const d = item({ item_id: 'd', goal_id: null });
    expect(splitUnattached([a, b, c, d])).toEqual({ linked: [a, c], unattached: [b, d] });
  });

  it('an all-linked list has an empty unattached side, never undefined', () => {
    expect(splitUnattached([item()]).unattached).toEqual([]);
  });
});

describe('collisionPartnersFor', () => {
  const collisions = [
    { shared: 'minuet in g major', labels: ['Minuet in G Major, BWV 822', 'Minuet in G Major (Anna Magdalena)'] },
    { shared: 'a short story', labels: ['A Short Story (Lichner)', 'A Short Story (Reinecke)'] },
  ];

  it('names every OTHER label sharing a needle with this one, never itself', () => {
    expect(collisionPartnersFor('Minuet in G Major, BWV 822', collisions)).toEqual([
      'Minuet in G Major (Anna Magdalena)',
    ]);
  });

  it('a label in no collision group gets an empty list, not undefined', () => {
    expect(collisionPartnersFor('Clair de lune', collisions)).toEqual([]);
  });

  it('a label in more than one group unions the partners, deduped', () => {
    const overlapping = [
      { shared: 'study', labels: ['Study', 'Study in C major'] },
      { shared: 'in c', labels: ['Study in C major', 'Song in C major'] },
    ];
    expect(collisionPartnersFor('Study in C major', overlapping)).toEqual(['Study', 'Song in C major']);
  });
});

/**
 * `moveQueuedRank` — the Up next group's reorder (a move-up/move-down control rather than pointer
 * drag; see the report for why). It normalizes the WHOLE ordered list to clean 1-based ranks and
 * returns only the rows whose rank actually changed, so a move writes exactly the rows it moved —
 * never a PATCH storm across a whole shelf for moving one piece one place.
 */
describe('moveQueuedRank', () => {
  const ranked = (rank: number, id: string) => item({ item_id: id, status: 'queued', meta: { [RANK_KEY]: rank } });

  it('moving up swaps rank with the row above — exactly those two rows change', () => {
    const ordered = [ranked(1, 'a'), ranked(2, 'b'), ranked(3, 'c')];
    expect(moveQueuedRank(ordered, 1, 'up')).toEqual([
      { item_id: 'b', rank: 1 },
      { item_id: 'a', rank: 2 },
    ]);
  });

  it('moving down swaps rank with the row below', () => {
    const ordered = [ranked(1, 'a'), ranked(2, 'b'), ranked(3, 'c')];
    expect(moveQueuedRank(ordered, 1, 'down')).toEqual([
      { item_id: 'c', rank: 2 },
      { item_id: 'b', rank: 3 },
    ]);
  });

  it('the first row cannot move up — no changes, not an out-of-range write', () => {
    const ordered = [ranked(1, 'a'), ranked(2, 'b')];
    expect(moveQueuedRank(ordered, 0, 'up')).toEqual([]);
  });

  it('the last row cannot move down', () => {
    const ordered = [ranked(1, 'a'), ranked(2, 'b')];
    expect(moveQueuedRank(ordered, 1, 'down')).toEqual([]);
  });

  it('rows with no rank on file yet are normalized to sequential ranks by the first move', () => {
    const unranked = [
      item({ item_id: 'a', status: 'queued', meta: null }),
      item({ item_id: 'b', status: 'queued', meta: null }),
    ];
    expect(moveQueuedRank(unranked, 1, 'up')).toEqual([
      { item_id: 'b', rank: 1 },
      { item_id: 'a', rank: 2 },
    ]);
  });
});

describe('headerCountLine', () => {
  it('renders the total and the year count from the numbers given, never recomputed', () => {
    expect(headerCountLine(14, 6, 'pieces')).toBe('14 PIECES · 6 LEARNED THIS YEAR');
  });

  it('uppercases whatever noun the payload gives, including one seen for the first time', () => {
    expect(headerCountLine(3, 0, 'katas')).toBe('3 KATAS · 0 LEARNED THIS YEAR');
  });
});
