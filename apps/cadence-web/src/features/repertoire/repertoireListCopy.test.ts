/**
 * Pure logic for the list screen (P6 "the room") — table-tested per CLAUDE.md's rule for every
 * deterministic router: `orderGroupItems` decides which sort a standing's rows get, and a wrong
 * pick fails silently (the row order looks plausible either way, nothing throws), so it gets a
 * row for every standing, not just the ones with a real sort.
 */
import { describe, it, expect } from 'vitest';
import type { RepertoireItem } from '@cadence/shared';
import { CATALOGUE_KEY, COLLECTION_KEY, COMPOSER_KEY, RANK_KEY, REPERTOIRE_GROUPS } from '@cadence/shared';
import {
  buildSecondLine,
  collisionPartnersFor,
  formatRowDate,
  GROUP_LINES,
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

/**
 * `GROUP_LINES` — the group header's own words, in the coach's voice. `REPERTOIRE_GROUPS`' header
 * text is a PROMPT string for the model (third person, imperative, names the schema word on
 * purpose); an earlier version of this screen put that in front of a person, which a review caught
 * (owner, 2026-09-02) as a nomenclature-rule break. These four lines replace it, pinned verbatim so
 * nobody drifts the wording at a second call site, plus a completeness check: a fifth standing
 * added to REPERTOIRE_GROUPS without a matching line here must fail loudly, not render blank.
 */
describe('GROUP_LINES', () => {
  it("renders the coach's own line for each standing, verbatim", () => {
    expect(GROUP_LINES.working).toBe("what we're working on now");
    expect(GROUP_LINES.queued).toBe("your order — I'll suggest the first");
    expect(GROUP_LINES.known).toBe('in rotation — longest rest first');
    expect(GROUP_LINES.retired).toBe('finished — counted, never scheduled');
  });

  it('never leaks the model-prompt scaffolding — the schema word quoted after "status"', () => {
    // Plain English words like "working" are fine in warm copy (GROUP_LINES.working says exactly
    // that); what must never appear is REPERTOIRE_GROUPS' own prompt wrapper, `status "word"`.
    for (const line of Object.values(GROUP_LINES)) {
      expect(line).not.toMatch(/status\s*"/i);
    }
  });

  it('is not the REPERTOIRE_GROUPS prompt text — the earlier "verbatim" reuse this replaces', () => {
    for (const { status, header } of REPERTOIRE_GROUPS) {
      expect(GROUP_LINES[status]).not.toBe(header);
    }
  });

  it('has an entry for every standing REPERTOIRE_GROUPS carries — a fifth standing cannot ship silent', () => {
    for (const { status } of REPERTOIRE_GROUPS) {
      expect(GROUP_LINES[status]).toBeTruthy();
    }
    expect(Object.keys(GROUP_LINES).sort()).toEqual(REPERTOIRE_GROUPS.map((g) => g.status).sort());
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

describe('buildSecondLine — composer · catalogue · collection · date, only what is on file', () => {
  const now = new Date('2026-09-02T12:00:00Z');

  it('composer and collection both on file, joined with the practiced date', () => {
    const i = item({
      meta: { [COMPOSER_KEY]: 'Debussy', [COLLECTION_KEY]: 'Suite bergamasque' },
      last_practiced_at: daysAgo(1, now),
    });
    expect(buildSecondLine(i, now)).toBe('Debussy · Suite bergamasque · yesterday');
  });

  it('a bare label with nothing on file renders an empty second line, not a lone separator', () => {
    expect(buildSecondLine(item({ meta: null, last_practiced_at: null }), now)).toBe('');
  });

  it('composer only — no dangling " · " where catalogue, collection, or the date would go', () => {
    expect(buildSecondLine(item({ meta: { [COMPOSER_KEY]: 'Hummel' }, last_practiced_at: null }), now)).toBe('Hummel');
  });

  it('catalogue alone — the one qualifier that actually tells same-titled pieces apart', () => {
    const i = item({ meta: { [CATALOGUE_KEY]: 'BWV 822' }, last_practiced_at: null });
    expect(buildSecondLine(i, now)).toBe('BWV 822');
  });

  it('composer and catalogue, catalogue second — ahead of collection, right after composer', () => {
    const i = item({ meta: { [COMPOSER_KEY]: 'J.S. Bach', [CATALOGUE_KEY]: 'BWV 822' }, last_practiced_at: null });
    expect(buildSecondLine(i, now)).toBe('J.S. Bach · BWV 822');
  });

  it('all four segments, in order: composer, catalogue, collection, date', () => {
    const i = item({
      meta: {
        [COMPOSER_KEY]: 'J.S. Bach',
        [CATALOGUE_KEY]: 'BWV 822',
        [COLLECTION_KEY]: 'Anna Magdalena Notebook',
      },
      last_practiced_at: daysAgo(1, now),
    });
    expect(buildSecondLine(i, now)).toBe('J.S. Bach · BWV 822 · Anna Magdalena Notebook · yesterday');
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

  it('near-miss: working is left in server order — it must NOT pick up rank, rest, or date sorting meant for the other three', () => {
    const items = [item({ status: 'working', label: 'Z' }), item({ status: 'working', label: 'A' })];
    // Server order (alphabetical from listRepertoire) is preserved as-is: no re-sort applied.
    expect(orderGroupItems('working', items).map((i) => i.label)).toEqual(['Z', 'A']);
  });

  it('retired sorts newest-finished-first', () => {
    const items = [
      item({ status: 'retired', label: 'oldest', learned_at: daysAgo(400) }),
      item({ status: 'retired', label: 'newest', learned_at: daysAgo(1) }),
      item({ status: 'retired', label: 'middle', learned_at: daysAgo(30) }),
    ];
    expect(orderGroupItems('retired', items).map((i) => i.label)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('retired: a backfilled row with no learned_at goes last, even if it was practiced yesterday', () => {
    const items = [
      item({ status: 'retired', label: 'backfilled', learned_at: null, last_practiced_at: daysAgo(1) }),
      item({ status: 'retired', label: 'dated', learned_at: daysAgo(200) }),
    ];
    expect(orderGroupItems('retired', items).map((i) => i.label)).toEqual(['dated', 'backfilled']);
  });

  it('retired: a tie on learned_at (both null) falls to last_practiced_at, newest first, then label', () => {
    const items = [
      item({ status: 'retired', label: 'B', learned_at: null, last_practiced_at: daysAgo(10) }),
      item({ status: 'retired', label: 'A', learned_at: null, last_practiced_at: daysAgo(2) }),
      item({ status: 'retired', label: 'C', learned_at: null, last_practiced_at: null }),
    ];
    expect(orderGroupItems('retired', items).map((i) => i.label)).toEqual(['A', 'B', 'C']);
  });
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
