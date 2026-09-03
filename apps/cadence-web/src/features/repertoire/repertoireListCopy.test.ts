/**
 * Pure logic for the list screen (P6 "the room") — table-tested per CLAUDE.md's rule for every
 * deterministic router: `orderGroupItems` decides which sort a standing's rows get, and a wrong
 * pick fails silently (the row order looks plausible either way, nothing throws), so it gets a
 * row for every standing, not just the ones with a real sort.
 */
import { describe, it, expect } from 'vitest';
import type { RepertoireItem } from '@cadence/shared';
import {
  DESCRIPTION_KEY,
  COLLECTION_KEY,
  COMPOSER_KEY,
  PRACTICE_NOTE_KEY,
  RANK_KEY,
  REPERTOIRE_GROUPS,
} from '@cadence/shared';
import {
  bucketsByYear,
  buildSecondLine,
  collisionPartnersFor,
  findMatches,
  formatRowDate,
  GROUP_LINES,
  groupStandingWord,
  headerCountLine,
  moveQueuedRank,
  orderGroupItems,
  shouldCollapseByYear,
  splitUnattached,
  standingWordFor,
  yearBucketLine,
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
    expect(GROUP_LINES.queued).toBe('not started yet, in your order');
    expect(GROUP_LINES.known).toBe('learned and still played');
    expect(GROUP_LINES.retired).toBe('finished');
  });

  /**
   * They are DEFINITIONS now (owner ruling 2026-09-03), matching the four the coach reads. The
   * three that changed each described machinery the app no longer runs — a rotation ordered by
   * rest, a first item she would suggest, a group she would never schedule — and copy that
   * describes a mechanism which has been deleted is a promise the app quietly stops keeping.
   */
  it('describes what a standing IS, never a mechanism behind it', () => {
    for (const line of Object.values(GROUP_LINES)) {
      expect(line).not.toMatch(/rotation|longest rest|suggest|schedul|counted/i);
    }
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

  it('collection alone reads as a plain fact', () => {
    const i = item({ meta: { [COLLECTION_KEY]: 'Anna Magdalena Notebook' }, last_practiced_at: null });
    expect(buildSecondLine(i, now)).toBe('Anna Magdalena Notebook');
  });

  it('all three segments, in order: composer, collection, date', () => {
    const i = item({
      meta: {
        [COMPOSER_KEY]: 'J.S. Bach',
        [COLLECTION_KEY]: 'Anna Magdalena Notebook',
      },
      last_practiced_at: daysAgo(1, now),
    });
    expect(buildSecondLine(i, now)).toBe('J.S. Bach · Anna Magdalena Notebook · yesterday');
  });

  /**
   * Two fields the row deliberately does NOT render, both silent if they came back: `catalogue` is
   * no longer a field at all (owner ruling 2026-09-03) and a stale one left in an old row's meta
   * must not reappear on the screen; `description` IS a field, and is up to 240 characters, which
   * would push everything else off a one-line row. It lives on the item screen, one tap away.
   */
  it('never renders a catalogue left on an old row', () => {
    const i = item({ meta: { catalogue: 'BWV 822', [COMPOSER_KEY]: 'J.S. Bach' }, last_practiced_at: null });
    expect(buildSecondLine(i, now)).toBe('J.S. Bach');
  });

  it('never renders the description — a sentence does not fit a row', () => {
    const i = item({
      meta: { [DESCRIPTION_KEY]: 'the fast one my teacher set', [COMPOSER_KEY]: 'J.S. Bach' },
      last_practiced_at: null,
    });
    expect(buildSecondLine(i, now)).toBe('J.S. Bach');
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

  /**
   * The practice note (P8) — sits after composer/catalogue/collection (the design's own order:
   * WHICH item, then how the work is going, then WHEN), so a book or a kata (which rarely carries the
   * other three) still gets an informative line — the note is simply the first segment present.
   */
  it('a stored note trails the identity qualifiers, ahead of the date', () => {
    const i = item({ meta: { [PRACTICE_NOTE_KEY]: 'bars 9-16', [COMPOSER_KEY]: 'Debussy' }, last_practiced_at: null });
    expect(buildSecondLine(i, now)).toBe('Debussy · bars 9-16');
  });

  it('a note with nothing else on file is the whole second line — kata (for 5th kyu)', () => {
    const i = item({ meta: { [PRACTICE_NOTE_KEY]: 'for 5th kyu' }, last_practiced_at: null });
    expect(buildSecondLine(i, now)).toBe('for 5th kyu');
  });

  it('a note plus the practiced date — books (a page, then when it was last opened)', () => {
    const i = item({ meta: { [PRACTICE_NOTE_KEY]: 'p. 240' }, last_practiced_at: daysAgo(1, now) });
    expect(buildSecondLine(i, now)).toBe('p. 240 · yesterday');
  });

  it('verses: "first stanza" reads as a plain fact, and no author never breaks the line', () => {
    const i = item({ meta: { [PRACTICE_NOTE_KEY]: 'first stanza' }, last_practiced_at: null });
    expect(buildSecondLine(i, now)).toBe('first stanza');
    expect(buildSecondLine(i, now)).not.toMatch(/only|just|still|behind/i);
  });

  it('a blank note is dropped, same as a blank composer — never a dangling separator', () => {
    const i = item({ meta: { [PRACTICE_NOTE_KEY]: '   ', [COMPOSER_KEY]: 'Hummel' }, last_practiced_at: null });
    expect(buildSecondLine(i, now)).toBe('Hummel');
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

  it('unranked known rows sort by rest, least recently practised first', () => {
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

  /**
   * A LADDER IS ANY ORDERED COLLECTION (owner ruling 2026-09-03: *"Kata isn't a special thing — it
   * was always an example"*). A group where every item carries a rank renders in rank order,
   * whatever kind the items are and whatever standing they sit under.
   *
   * The first row below is the one that FLIPPED: a fully-ranked group of ordinary pieces sorted by
   * REST until today, because the coach read row position as a rotation and the screen could not be
   * allowed to disagree with her about which row was due first. She reads no position now — the
   * marker and `pickDueNext` are both gone — so rank order disagrees with nothing, and what the
   * person sees is the order they put their own material in.
   *
   * Table: a ranked group of pieces (rank now wins), a ranked group of kata (unchanged), one
   * unranked item (falls back to the standing's rule), a mixed-kind ranked group (rank wins — kind
   * is not consulted at all any more), and a ranked Learned group (rank beats newest-finished).
   */
  describe('a fully ranked group renders in rank order, whatever it holds', () => {
    const ranked = (rank: number, label: string, status: RepertoireItem['status'] = 'known') =>
      item({ status, label, kind: 'kata', meta: { [RANK_KEY]: rank } });

    it('THE FLIP: a fully-ranked group of ordinary PIECES now sorts by rank, not by rest', () => {
      const items = [
        item({ status: 'known', label: 'A', kind: 'piece', meta: { [RANK_KEY]: 1 }, last_practiced_at: daysAgo(1) }),
        item({ status: 'known', label: 'B', kind: 'piece', meta: { [RANK_KEY]: 2 }, last_practiced_at: daysAgo(9) }),
        item({ status: 'known', label: 'C', kind: 'piece', meta: { [RANK_KEY]: 3 }, last_practiced_at: daysAgo(19) }),
      ];
      // Rest order would read C, B, A — that was the rule while the coach read row position.
      expect(orderGroupItems('known', items).map((i) => i.label)).toEqual(['A', 'B', 'C']);
    });

    it('a ranked kata group still reads by rank — the belt order, unchanged', () => {
      const items = [
        item({
          status: 'known',
          label: 'brown belt',
          kind: 'kata',
          meta: { [RANK_KEY]: 3 },
          last_practiced_at: daysAgo(1),
        }),
        item({
          status: 'known',
          label: 'yellow belt',
          kind: 'kata',
          meta: { [RANK_KEY]: 1 },
          last_practiced_at: daysAgo(9),
        }),
        item({
          status: 'known',
          label: 'orange belt',
          kind: 'kata',
          meta: { [RANK_KEY]: 2 },
          last_practiced_at: daysAgo(19),
        }),
      ];
      expect(orderGroupItems('known', items).map((i) => i.label)).toEqual(['yellow belt', 'orange belt', 'brown belt']);
    });

    it('remove one rank and it falls back to the standing rule (known: rest order)', () => {
      const items = [
        item({
          status: 'known',
          label: 'yellow belt',
          kind: 'kata',
          meta: { [RANK_KEY]: 1 },
          last_practiced_at: daysAgo(1),
        }),
        item({ status: 'known', label: 'ungraded', kind: 'kata', meta: null, last_practiced_at: daysAgo(19) }),
        item({
          status: 'known',
          label: 'orange belt',
          kind: 'kata',
          meta: { [RANK_KEY]: 2 },
          last_practiced_at: daysAgo(9),
        }),
      ];
      // Falls back to byRest: least recently practised (ungraded, 19 days) first — NOT rank order.
      expect(orderGroupItems('known', items).map((i) => i.label)).toEqual(['ungraded', 'orange belt', 'yellow belt']);
    });

    it('a kata and a piece in one ranked group read by rank too — kind is not consulted', () => {
      const items = [
        item({
          status: 'known',
          label: 'yellow belt',
          kind: 'kata',
          meta: { [RANK_KEY]: 1 },
          last_practiced_at: daysAgo(1),
        }),
        item({
          status: 'known',
          label: 'Étude',
          kind: 'piece',
          meta: { [RANK_KEY]: 2 },
          last_practiced_at: daysAgo(19),
        }),
      ];
      expect(orderGroupItems('known', items).map((i) => i.label)).toEqual(['yellow belt', 'Étude']);
    });

    it('a fully ranked Learned group reads by rank, not newest-finished-first', () => {
      const items = [
        item({ status: 'retired', label: 'black belt', kind: 'kata', meta: { [RANK_KEY]: 3 }, learned_at: daysAgo(1) }),
        item({
          status: 'retired',
          label: 'yellow belt',
          kind: 'kata',
          meta: { [RANK_KEY]: 1 },
          learned_at: daysAgo(400),
        }),
        item({
          status: 'retired',
          label: 'orange belt',
          kind: 'kata',
          meta: { [RANK_KEY]: 2 },
          learned_at: daysAgo(200),
        }),
      ];
      expect(orderGroupItems('retired', items).map((i) => i.label)).toEqual([
        'yellow belt',
        'orange belt',
        'black belt',
      ]);
    });

    it('a single ranked item is trivially a full ladder', () => {
      expect(orderGroupItems('working', [ranked(1, 'white belt', 'working')]).map((i) => i.label)).toEqual([
        'white belt',
      ]);
    });

    it('an unranked group is not a ladder at all — Learning keeps server order', () => {
      const items = [item({ status: 'working', label: 'Z' }), item({ status: 'working', label: 'A' })];
      expect(orderGroupItems('working', items).map((i) => i.label)).toEqual(['Z', 'A']);
    });
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

  it('a books shelf reads FINISHED, not LEARNED, this year (P8)', () => {
    expect(headerCountLine(41, 41, 'books')).toBe('41 BOOKS · 41 FINISHED THIS YEAR');
  });

  it('the FINISHED swap is case-insensitive on the noun, but only matches "books" itself', () => {
    expect(headerCountLine(1, 1, 'Books')).toBe('1 BOOKS · 1 FINISHED THIS YEAR');
    expect(headerCountLine(1, 1, 'notebooks')).toBe('1 NOTEBOOKS · 1 LEARNED THIS YEAR');
  });

  it("a verses shelf reads BY HEART, matching cardHeader.ts's own word for the same domain (P5)", () => {
    expect(headerCountLine(5, 5, 'verses')).toBe('5 VERSES · 5 BY HEART THIS YEAR');
    expect(headerCountLine(1, 1, 'verse')).toBe('1 VERSE · 1 BY HEART THIS YEAR');
  });
});

/**
 * `standingWordFor` / `groupStandingWord` — the standing word a book's Learned status reads as
 * "Finished" (P8). The row-level function is per-item and stays accurate in a mixed shelf; the
 * group-level one is one word for a whole section, so it only swaps when EVERY item in the group
 * is a book.
 */
describe('standingWordFor — the per-row standing word', () => {
  it('is unchanged for every standing except a book in Learned', () => {
    expect(standingWordFor('book', 'queued')).toBe('Up next');
    expect(standingWordFor('book', 'working')).toBe('Learning');
    expect(standingWordFor('book', 'known')).toBe('Keeping up');
    expect(standingWordFor(null, 'retired')).toBe('Learned');
    expect(standingWordFor('piece', 'retired')).toBe('Learned');
  });

  it('a book in Learned reads "Finished"', () => {
    expect(standingWordFor('book', 'retired')).toBe('Finished');
  });

  it('matches "book" case-insensitively and trimmed, but not a longer word containing it', () => {
    expect(standingWordFor('Book', 'retired')).toBe('Finished');
    expect(standingWordFor('  book  ', 'retired')).toBe('Finished');
    expect(standingWordFor('notebook', 'retired')).toBe('Learned');
  });
});

describe('groupStandingWord — the section header word', () => {
  it('reads "Finished" only when every item in the group is a book', () => {
    const allBooks = [item({ kind: 'book' }), item({ kind: 'book' })];
    expect(groupStandingWord('retired', allBooks)).toBe('Finished');
  });

  it('a shelf mixing a book with something else keeps "Learned" — a header is one word for the section', () => {
    const mixed = [item({ kind: 'book' }), item({ kind: 'piece' })];
    expect(groupStandingWord('retired', mixed)).toBe('Learned');
  });

  it('an empty group never claims "Finished" — nothing to be all-books about', () => {
    expect(groupStandingWord('retired', [])).toBe('Learned');
  });

  it('only the Learned standing is eligible — a book in Learning still reads "Learning"', () => {
    expect(groupStandingWord('working', [item({ kind: 'book', status: 'working' })])).toBe('Learning');
  });
});

/**
 * The Learned-books collapse (P8: "books — a record, 200 long"): once an all-book Learned group
 * passes 30 items, it collapses into year buckets behind a find field. Table: the threshold, and
 * the two ways a shelf is NOT eligible.
 */
describe('shouldCollapseByYear', () => {
  const books = (n: number, over: Partial<RepertoireItem> = {}) =>
    Array.from({ length: n }, (_, i) => item({ item_id: `b${i}`, kind: 'book', status: 'retired', ...over }));

  it('collapses an all-book Learned shelf once it passes the threshold', () => {
    expect(shouldCollapseByYear('retired', books(31))).toBe(true);
  });

  it('does not collapse at or under the threshold', () => {
    expect(shouldCollapseByYear('retired', books(30))).toBe(false);
  });

  it('does not collapse a non-Learned group, even with plenty of books', () => {
    expect(shouldCollapseByYear('known', books(50, { status: 'known' }))).toBe(false);
  });

  it('does not collapse a large Learned shelf that is not ALL books', () => {
    const mostlyBooks = books(30).concat(item({ item_id: 'p1', kind: 'piece', status: 'retired' }));
    expect(shouldCollapseByYear('retired', mostlyBooks)).toBe(false);
  });
});

describe('bucketsByYear', () => {
  it('one bucket per calendar year, newest first', () => {
    const items = [
      item({ learned_at: '2024-03-01T00:00:00Z' }),
      item({ learned_at: '2025-01-15T00:00:00Z' }),
      item({ learned_at: '2025-11-30T00:00:00Z' }),
    ];
    expect(bucketsByYear(items)).toEqual([
      { year: 2025, count: 2 },
      { year: 2024, count: 1 },
    ]);
  });

  it('an undated (backfilled) item buckets separately and sorts last, after every real year', () => {
    const items = [item({ learned_at: '2025-01-15T00:00:00Z' }), item({ learned_at: null })];
    expect(bucketsByYear(items)).toEqual([
      { year: 2025, count: 1 },
      { year: null, count: 1 },
    ]);
  });
});

describe('yearBucketLine', () => {
  it('renders "YYYY · N finished ›", verbatim', () => {
    expect(yearBucketLine({ year: 2025, count: 41 })).toBe('2025 · 41 finished ›');
  });

  it('an undated bucket reads "Not dated", never a guessed year', () => {
    expect(yearBucketLine({ year: null, count: 3 })).toBe('Not dated · 3 finished ›');
  });
});

describe('findMatches — the collapsed shelf’s own filter', () => {
  const shelf = [
    item({ label: 'The Hobbit' }),
    item({ label: 'The Fellowship of the Ring' }),
    item({ label: 'Silas Marner' }),
  ];

  it('matches a case-insensitive substring of the label', () => {
    expect(findMatches(shelf, 'hobbit').map((i) => i.label)).toEqual(['The Hobbit']);
    expect(findMatches(shelf, 'THE F').map((i) => i.label)).toEqual(['The Fellowship of the Ring']);
  });

  it('an empty or whitespace-only query returns everything, unfiltered', () => {
    expect(findMatches(shelf, '')).toEqual(shelf);
    expect(findMatches(shelf, '   ')).toEqual(shelf);
  });

  it('no match is an empty list, not an error or the unfiltered shelf', () => {
    expect(findMatches(shelf, 'nonexistent title')).toEqual([]);
  });
});
