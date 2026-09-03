import { describe, expect, it } from 'vitest';
import {
  DESCRIPTION_KEY,
  DESCRIPTION_MAX,
  PRACTICE_NOTE_KEY,
  REPERTOIRE_GROUPS,
  STANDING_MEANS,
  STANDING_NAMES,
  TEMPO_BPM_KEY,
  byRest,
  descriptionOf,
  pieceQualifiers,
  practiceNoteOf,
  qualifierMeta,
  renderRepertoire,
  settledTempo,
  tempoMeta,
  type RepertoireLike,
} from './repertoire.ts';

const item = (label: string, over: Partial<RepertoireLike> = {}): RepertoireLike => ({
  label,
  status: 'known',
  ...over,
});

const daysAgo = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString();

/**
 * `byRest` is now the whole of the rest ordering — `pickDueNext` is gone (owner ruling 2026-09-03:
 * nothing in what the coach reads may tell her which item to choose). The comparator survives as a
 * DISPLAY fact: the list screen orders an unranked Keeping-up group oldest-practised first, and the
 * date is on every row, so the order states something the person can check rather than a pick.
 *
 * The three rows below are `pickDueNext`'s own ordering rows, moved onto the comparator that still
 * has the behaviour: longest rest first, never-practised ahead of practised, ties broken stably.
 * The fourth — "only known items rotate" — is deliberately NOT replaced: no code filters by
 * standing for a pick any more, because no code makes a pick.
 */
describe('byRest', () => {
  it('orders the item resting longest first', () => {
    const items = [
      item('A Short Story', { last_practiced_at: daysAgo(1) }),
      item('Écossaise', { last_practiced_at: daysAgo(19) }),
      item('Minuet in G', { last_practiced_at: daysAgo(9) }),
    ];
    expect([...items].sort(byRest).map((i) => i.label)).toEqual(['Écossaise', 'Minuet in G', 'A Short Story']);
  });

  it('a never-practiced item rests longer than any practiced one', () => {
    const items = [
      item('Écossaise', { last_practiced_at: '2020-01-01T00:00:00Z' }),
      item('Arietta', { last_practiced_at: null }),
    ];
    expect([...items].sort(byRest)[0]?.label).toBe('Arietta');
  });

  it('ties break stably (started_at, then label), not by row order', () => {
    const items = [
      item('B piece', { last_practiced_at: null, started_at: '2026-08-02T00:00:00Z' }),
      item('A piece', { last_practiced_at: null, started_at: '2026-08-02T00:00:00Z' }),
      item('C piece', { last_practiced_at: null, started_at: '2026-08-01T00:00:00Z' }),
    ];
    expect([...items].sort(byRest)[0]?.label).toBe('C piece');
    expect([...items].reverse().sort(byRest)[0]?.label).toBe('C piece');
  });
});

/**
 * The four standings, as DEFINITIONS (owner ruling 2026-09-03: "we don't need to give the coach any
 * direction on how to pick"). Each group header carries two things and no third:
 *
 *  - what the standing MEANS, so she knows what the group is without inferring it — never what to
 *    do with it, and never which of its items to reach for;
 *  - the status word she must write back, because the user-facing label and the schema word are
 *    deliberately different — and one pair actively collides. "Learned" is the group name for
 *    `retired`, while `learned` is the verb that means the opposite thing ("crossed into Keeping
 *    up just now"). A header naming only the label would have her write status "learned" to move
 *    something into the group called Learned, and land it in Keeping up with a celebration.
 *
 * The one imperative left is on `queued` — "Never start one unless they ask" — and it stays because
 * it is a consent boundary, not a picking rule: it says what she may not do to their material
 * without being asked, never which of the four groups today's work comes from.
 */
describe('renderRepertoire — the four standings', () => {
  const oneOfEach = (now: number) => [
    item('Melody', { status: 'working', kind: 'piece', last_practiced_at: new Date(now - 86_400_000).toISOString() }),
    item('Frankie and Johnnie', { status: 'queued', kind: 'piece' }),
    item('Écossaise', {
      status: 'known',
      kind: 'piece',
      last_practiced_at: new Date(now - 20 * 86_400_000).toISOString(),
    }),
    item('Cradle Song', { status: 'retired', kind: 'piece' }),
  ];

  it('renders every standing under a header naming it, its status word, and what it MEANS', () => {
    const now = Date.now();
    const text = renderRepertoire(oneOfEach(now), now);
    const headers: string[] = [
      'Learning (status "working") — being worked on now:',
      'Up next (status "queued") — not started, in the user\'s own order. Never start one unless they ask:',
      'Keeping up (status "known") — learned and still played:',
      'Learned (status "retired") — finished; not played any more:',
    ];
    for (const header of headers) expect(text).toContain(header);
  });

  /**
   * The near-miss for the ruling, and the reason it is a table of words rather than one assertion:
   * every phrase below shipped in a header or an item line until 2026-09-03, and each one is a
   * silent failure — a render carrying "longest rest first" still looks like a correct list, and
   * nothing throws. What they have in common is that they rank the shelf FOR her.
   */
  it('ranks nothing — no marker, no order word, no count of how many to take', () => {
    const now = Date.now();
    const text = renderRepertoire(oneOfEach(now), now);
    for (const banned of [
      /DUE NEXT/i,
      /longest rest/i,
      /rotation/i,
      /draw warm-?up/i,
      /play-?out/i,
      /keep it to one/i,
      /propose the top/i,
      /never schedule/i,
      /count these/i,
    ]) {
      expect(text, `"${banned}" tells her which item to reach for`).not.toMatch(banned);
    }
  });

  it('orders the groups Learning, Up next, Keeping up, Learned — the order she reads them in', () => {
    const now = Date.now();
    const text = renderRepertoire(oneOfEach(now), now);
    const at = (s: string) => text.indexOf(s);
    expect(at('Learning (status')).toBeGreaterThanOrEqual(0);
    expect(at('Learning (status')).toBeLessThan(at('Up next (status'));
    expect(at('Up next (status')).toBeLessThan(at('Keeping up (status'));
    expect(at('Keeping up (status')).toBeLessThan(at('Learned (status'));
  });

  it('gives queued and retired items the same per-line marks as the rest', () => {
    const now = Date.now();
    const text = renderRepertoire(
      [
        item('Frankie and Johnnie', { status: 'queued', kind: 'piece' }),
        item('Cradle Song', { status: 'retired', kind: 'piece', last_practiced_at: new Date(now).toISOString() }),
      ],
      now,
    );
    expect(text).toContain('- Frankie and Johnnie (piece; not worked yet while on file)');
    expect(text).toContain('- Cradle Song (piece; worked today)');
  });

  it('sends Learning, Up next and Keeping up in FULL — no cap on what they are actually working on', () => {
    for (const status of ['working', 'queued', 'known'] as const) {
      const many = Array.from({ length: 40 }, (_, i) => item(`Piece ${String(i).padStart(2, '0')}`, { status }));
      const text = renderRepertoire(many);
      for (const i of [0, 14, 20, 39]) expect(text).toContain(`Piece ${String(i).padStart(2, '0')}`);
      expect(text).not.toContain('more on file');
    }
  });

  it('omits a group nobody has anything in', () => {
    const text = renderRepertoire([item('Écossaise', { status: 'known' })]);
    expect(text).toContain('Keeping up (status "known")');
    expect(text).not.toContain('Up next');
    expect(text).not.toContain('Learning (status');
    expect(text).not.toContain('Learned (status');
  });
});

/**
 * `REPERTOIRE_GROUPS` and `byRest` are exported for one consumer outside this file: the list
 * screen (P6, "the room"), which renders its own four group headers from these same words and
 * sorts the whole Keeping-up group by this same rest order — never a hand-typed second copy of
 * either (CLAUDE.md). These two tests pin the exported SHAPE so a rename or reorder here is caught
 * where it happens, not as a silent drift discovered on the screen.
 */
describe('REPERTOIRE_GROUPS (exported for the list screen)', () => {
  it('is exactly the four standings, in the order the screen must show them', () => {
    expect(REPERTOIRE_GROUPS.map((g) => g.status)).toEqual(['working', 'queued', 'known', 'retired']);
  });

  it('every header still carries its name, its status word, and a definition clause', () => {
    for (const { status, header } of REPERTOIRE_GROUPS) {
      expect(header).toContain(`(status "${status}")`);
      expect(header).toMatch(/ — .+:$/);
    }
  });

  /**
   * The header is BUILT from the two records, so the name and the definition exist once each: the
   * API's per-item line (session-practice-facts.ts) names a standing from `STANDING_NAMES` and
   * states the definitions from `STANDING_MEANS`, and a header typed out whole would be a second
   * copy of both, free to drift.
   */
  it('is assembled from STANDING_NAMES and STANDING_MEANS — no header is typed out twice', () => {
    for (const { status, header } of REPERTOIRE_GROUPS) {
      expect(header).toBe(`${STANDING_NAMES[status]} (status "${status}") — ${STANDING_MEANS[status]}:`);
    }
  });

  it('names and definitions cover all four standings and nothing else', () => {
    const four = REPERTOIRE_GROUPS.map((g) => g.status).sort();
    expect(Object.keys(STANDING_NAMES).sort()).toEqual(four);
    expect(Object.keys(STANDING_MEANS).sort()).toEqual(four);
  });

  it('keeps the one consent boundary on Up next, and no picking rule anywhere', () => {
    expect(STANDING_MEANS.queued).toContain('Never start one unless they ask');
    for (const means of Object.values(STANDING_MEANS)) {
      expect(means).not.toMatch(/longest rest|warm-?up|play-?out|keep it to one|propose the top|never schedule/i);
    }
  });
});

describe('renderRepertoire', () => {
  it('groups by status and dates by relative day-count', () => {
    // One clock for the fixtures AND the render. The file's `daysAgo` calls Date.now() itself, a
    // few instructions after `now` is captured — same millisecond on a fast machine, but any
    // ≥1ms hiccup between the two reads makes floor(20d − ε) land on 19 and this test fail. It
    // did, on a busy CI runner (2026-09-01); exact day-counts must derive from the injected now.
    const now = Date.now();
    const at = (n: number): string => new Date(now - n * 86_400_000).toISOString();
    const text = renderRepertoire(
      [
        item('Melody', { status: 'working', kind: 'piece', last_practiced_at: at(1) }),
        item('Écossaise', { kind: 'piece', last_practiced_at: at(20) }),
        item('A Short Story', { kind: 'piece', last_practiced_at: at(0.2) }),
        item('Cradle Song', { status: 'retired' }),
      ],
      now,
    );
    expect(text).toContain('Learning (status "working")');
    expect(text).toContain('- Melody (piece; worked yesterday)');
    expect(text).toContain('Keeping up (status "known")');
    expect(text).toContain('- Écossaise (piece; worked 20 days ago)');
    expect(text).toContain('- A Short Story (piece; worked today)');
    expect(text).toContain('- Cradle Song (not worked yet while on file)');
  });

  it('renders empty for an empty list, so callers can omit the section cleanly', () => {
    expect(renderRepertoire([])).toBe('');
  });
});

/**
 * Learned is the one capped group (owner ruling 2026-09-03): *"a 500-piece Learned list should not
 * go to the coach every turn; the total plus the ability to ask for more limits tokens and gives
 * her a more relevant list."* What they are actually working on — Learning, Up next, Keeping up —
 * rides in full.
 *
 * The ranking is the LATER of the two dates a finished item can carry, because both are practices:
 * `learned_at` is the day they finished it, and `last_practiced_at` is any time they have played it
 * since. Ranking on either alone hides half the shelf — a piece finished in 2019 and played last
 * week is recent, and so is one finished last week and never touched since.
 */
describe('renderRepertoire — Learned is capped at 12, and says how many there are', () => {
  const learned = (label: string, over: Partial<RepertoireLike> = {}): RepertoireLike =>
    item(label, { status: 'retired', kind: 'piece', ...over });

  it('shows the 12 most recent and states the total', () => {
    const many = Array.from({ length: 214 }, (_, i) =>
      learned(`Piece ${String(i).padStart(3, '0')}`, {
        learned_at: daysAgo(i + 1),
      }),
    );
    const text = renderRepertoire(many);
    expect(text).toContain('Learned: 214 items — 12 most recent shown');
    expect(text.split('\n').filter((l) => l.trim().startsWith('- '))).toHaveLength(12);
    expect(text).toContain('Piece 000'); // finished yesterday — the most recent
    expect(text).toContain('Piece 011'); // the 12th
    expect(text).not.toContain('Piece 012'); // the 13th is over the cap
  });

  it('states the total without a "shown" clause when the whole group fits', () => {
    const few = Array.from({ length: 9 }, (_, i) => learned(`Piece ${i}`, { learned_at: daysAgo(i + 1) }));
    const text = renderRepertoire(few);
    expect(text).toContain('Learned: 9 items');
    expect(text).not.toContain('most recent shown');
  });

  it('counts the day it was finished as a practice — a 2019 piece played last week is recent', () => {
    const items = [
      learned('finished long ago, played last week', { learned_at: daysAgo(2000), last_practiced_at: daysAgo(7) }),
      learned('finished last month, untouched since', { learned_at: daysAgo(30), last_practiced_at: null }),
    ];
    const lines = renderRepertoire(items)
      .split('\n')
      .filter((l) => l.trim().startsWith('- '));
    expect(lines[0]).toContain('finished long ago, played last week');
    expect(lines[1]).toContain('finished last month, untouched since');
  });

  it('puts an item with no date at all last, never at a guessed position', () => {
    const items = [
      learned('no date', { learned_at: null, last_practiced_at: null }),
      learned('dated', { learned_at: daysAgo(900) }),
    ];
    const lines = renderRepertoire(items)
      .split('\n')
      .filter((l) => l.trim().startsWith('- '));
    expect(lines[0]).toContain('dated');
    expect(lines[1]).toContain('no date');
  });

  it('caps Learned without touching the other three, on one mixed shelf', () => {
    const shelf = [
      ...Array.from({ length: 20 }, (_, i) => item(`Keeping ${i}`, { status: 'known' })),
      ...Array.from({ length: 20 }, (_, i) => learned(`Done ${i}`, { learned_at: daysAgo(i + 1) })),
    ];
    const text = renderRepertoire(shelf);
    for (let i = 0; i < 20; i += 1) expect(text).toContain(`Keeping ${i}`);
    expect(text).toContain('Learned: 20 items — 12 most recent shown');
    expect(text).not.toContain('Done 12');
  });
});

describe('piece qualifiers', () => {
  it('round-trips through the patch it writes', () => {
    const q = { composer: 'J.S. Bach', description: 'the fast one in G', note: 'bars 9-16', rank: 4 };
    expect(pieceQualifiers(qualifierMeta(q))).toEqual(q);
  });

  it('writes only the fields given, so a partial edit never blanks the others', () => {
    expect(qualifierMeta({ composer: 'Weber' })).toEqual({ composer: 'Weber' });
    expect(Object.keys(qualifierMeta({}))).toEqual([]);
  });

  it('ignores blanks, non-strings, and a rank that is not a positive whole number', () => {
    expect(pieceQualifiers({ composer: '  ', description: null, rank: 0 })).toEqual({});
    expect(pieceQualifiers({ rank: 2.5 })).toEqual({});
    expect(pieceQualifiers({ rank: '3' })).toEqual({});
    expect(qualifierMeta({ composer: '   ', rank: -1 })).toEqual({});
  });

  it('is empty for an item with no meta at all', () => {
    expect(pieceQualifiers(null)).toEqual({});
    expect(pieceQualifiers(undefined)).toEqual({});
  });

  it('coexists with the settled tempo in the same meta', () => {
    const meta = { ...tempoMeta({ bpm: 72, meter: 3 }), ...qualifierMeta({ composer: 'Hummel' }) };
    expect(settledTempo(meta)).toEqual({ bpm: 72, meter: 3 });
    expect(pieceQualifiers(meta)).toEqual({ composer: 'Hummel' });
  });

  /**
   * `catalogue` was a qualifier until 2026-09-03 (owner: *"Catalogue number is very music-specific
   * and adds little... We're overly optimising for one use case"*). No migration ran, so rows in
   * the wild still carry the key — the read must simply ignore it, and the write must never put it
   * back. Both are silent failures otherwise: a stale key that still round-tripped would keep the
   * field alive on every screen that renders whatever `pieceQualifiers` returns.
   */
  it('ignores a catalogue left on an old row, rather than reading it back as a field', () => {
    expect(pieceQualifiers({ catalogue: 'BWV 822' })).toEqual({});
    expect(pieceQualifiers({ composer: 'J.S. Bach', catalogue: 'BWV 822' })).toEqual({ composer: 'J.S. Bach' });
  });

  it('never writes a catalogue back, even when one is handed in', () => {
    expect(qualifierMeta({ composer: 'J.S. Bach', catalogue: 'BWV 822' } as never)).toEqual({
      composer: 'J.S. Bach',
    });
  });
});

/**
 * The description (owner ruling 2026-09-03) — the person's own words for WHICH ONE this is. It
 * answers the question composer and collection answer, for every item that has neither: a kata, a
 * prayer, a poem, a book. It replaced `catalogue`, which answered it for exactly one domain.
 */
describe('the description', () => {
  it('round-trips through the patch it writes, alongside the other qualifiers', () => {
    const q = { composer: 'J.S. Bach', description: 'the one my teacher set' };
    expect(pieceQualifiers(qualifierMeta(q))).toEqual(q);
  });

  it('is folded into meta under its own key, not a hand-copied string', () => {
    expect(qualifierMeta({ description: 'the fast one in G' })).toEqual({ [DESCRIPTION_KEY]: 'the fast one in G' });
  });

  it('gets more room than a qualifier, because it is a sentence — 240 characters, trimmed', () => {
    const long = 'x'.repeat(300);
    expect(pieceQualifiers({ [DESCRIPTION_KEY]: `  ${long}  ` }).description).toBe(long.slice(0, DESCRIPTION_MAX));
    expect(DESCRIPTION_MAX).toBe(240);
  });

  it('drops a blank one the way every other qualifier string is dropped', () => {
    expect(pieceQualifiers({ [DESCRIPTION_KEY]: '   ' })).toEqual({});
    expect(qualifierMeta({ description: '   ' })).toEqual({});
  });

  it('is absent, never empty, for an item that has none', () => {
    expect(pieceQualifiers({ composer: 'Hummel' }).description).toBeUndefined();
    expect(descriptionOf(null)).toBeUndefined();
    expect(descriptionOf({ [DESCRIPTION_KEY]: 42 })).toBeUndefined();
    expect(descriptionOf({ [DESCRIPTION_KEY]: 'the slow one' })).toBe('the slow one');
  });

  it('reaches the coach on the item line, as a fact', () => {
    const out = renderRepertoire([
      item('Minuet in G Major', { kind: 'piece', meta: { [DESCRIPTION_KEY]: 'the fast one my teacher set' } }),
    ]);
    expect(out).toContain('description: the fast one my teacher set');
  });

  it('says nothing at all when there is none — never an empty "description:"', () => {
    expect(renderRepertoire([item('Minuet')])).not.toContain('description:');
  });
});

/**
 * The practice note (P8: "the practice note gets a store") — how the work is going, not WHICH item
 * this is, so it rides the same qualifier read/patch rather than a parallel pair of functions: one
 * PATCH from the item screen writes composer/collection/description/rank/note together.
 */
describe('the practice note', () => {
  it('round-trips through the patch it writes, alongside the other qualifiers', () => {
    const q = { composer: 'J.S. Bach', note: 'bars 9–16' };
    expect(pieceQualifiers(qualifierMeta(q))).toEqual(q);
  });

  it('is folded into meta under its own key, not a hand-copied string', () => {
    expect(qualifierMeta({ note: 'p. 240' })).toEqual({ [PRACTICE_NOTE_KEY]: 'p. 240' });
  });

  it('a note-only patch never touches the other qualifiers', () => {
    expect(qualifierMeta({ note: 'first stanza' })).toEqual({ [PRACTICE_NOTE_KEY]: 'first stanza' });
  });

  it('ignores a blank note the same way a blank composer is ignored', () => {
    expect(pieceQualifiers({ [PRACTICE_NOTE_KEY]: '   ' })).toEqual({});
    expect(qualifierMeta({ note: '   ' })).toEqual({});
  });

  it('trims and caps a note at 120 characters, same bound as every other qualifier string', () => {
    const long = 'x'.repeat(150);
    expect(pieceQualifiers({ [PRACTICE_NOTE_KEY]: `  ${long}  ` })?.note).toBe(long.slice(0, 120));
  });

  it('is absent for an item with no note on file', () => {
    expect(pieceQualifiers({ composer: 'Hummel' }).note).toBeUndefined();
    expect(pieceQualifiers(null).note).toBeUndefined();
  });

  describe('practiceNoteOf — the note read on its own', () => {
    it('reads a stored note back', () => {
      expect(practiceNoteOf({ [PRACTICE_NOTE_KEY]: 'for 5th kyu' })).toBe('for 5th kyu');
    });

    it('is undefined where there is none, or meta itself is absent', () => {
      expect(practiceNoteOf({})).toBeUndefined();
      expect(practiceNoteOf({ composer: 'Hummel' })).toBeUndefined();
      expect(practiceNoteOf(null)).toBeUndefined();
      expect(practiceNoteOf(undefined)).toBeUndefined();
    });

    it('ignores a non-string value rather than throwing', () => {
      expect(practiceNoteOf({ [PRACTICE_NOTE_KEY]: 42 })).toBeUndefined();
    });
  });
});

/**
 * A collection is a ROW now, not a name copied onto every item (owner ruling 2026-09-03: *"a
 * collection only works if it's not free-text"*). The item carries `collection_id` and reads back
 * `collection_name`; `meta.collection` is no longer written or read, and the two helpers that made
 * the old name behave — `collectionsOf` and `collapseCollection` — went with it, because the
 * database's unique index on (user_id, lower(name)) does that job now.
 *
 * Both halves are pinned for the same reason `catalogue` is: rows in the wild still carry the old
 * key, and a read that still returned it would keep the field alive on every screen that renders
 * whatever `pieceQualifiers` hands back.
 */
describe('the collection is off meta', () => {
  it('ignores a collection left on an old row, rather than reading it back as a field', () => {
    expect(pieceQualifiers({ collection: 'Suzuki Book 2' })).toEqual({});
    expect(pieceQualifiers({ composer: 'J.S. Bach', collection: 'Suzuki Book 2' })).toEqual({
      composer: 'J.S. Bach',
    });
  });

  it('never writes a collection back, even when one is handed in', () => {
    expect(qualifierMeta({ composer: 'J.S. Bach', collection: 'Suzuki Book 2' } as never)).toEqual({
      composer: 'J.S. Bach',
    });
  });

  it('reaches the coach on the item line, from the joined name', () => {
    const out = renderRepertoire([item('Ecossaise', { kind: 'piece', collection_name: 'Suzuki Book 2' })]);
    expect(out).toContain('- Ecossaise (piece; not worked yet while on file; collection: Suzuki Book 2)');
  });

  it('says nothing at all when the item is in none — never an empty "collection:"', () => {
    expect(renderRepertoire([item('Ecossaise')])).not.toContain('collection:');
    expect(renderRepertoire([item('Ecossaise', { collection_name: null })])).not.toContain('collection:');
  });

  it('is not read off meta any more, however the old key still reads', () => {
    expect(renderRepertoire([item('Ecossaise', { meta: { collection: 'Suzuki Book 2' } })])).not.toContain(
      'collection:',
    );
  });

  it('keeps the collection alongside the other facts on the line', () => {
    const out = renderRepertoire([
      item('Ecossaise', {
        kind: 'piece',
        collection_name: 'Suzuki Book 2',
        meta: { tempo_bpm: 66, [DESCRIPTION_KEY]: 'the fast one in G', [PRACTICE_NOTE_KEY]: 'bars 9-16' },
      }),
    ]);
    expect(out).toContain(
      'settled tempo 66 bpm; collection: Suzuki Book 2; description: the fast one in G; note: bars 9-16)',
    );
  });
});

describe('the settled tempo', () => {
  it('reads a stored tempo back', () => {
    expect(settledTempo({ tempo_bpm: 72, tempo_meter: 3 })).toEqual({ bpm: 72, meter: 3 });
  });

  it('is undefined when there is none — absence must not become a default tempo', () => {
    expect(settledTempo(null)).toBeUndefined();
    expect(settledTempo(undefined)).toBeUndefined();
    expect(settledTempo({})).toBeUndefined();
    expect(settledTempo({ composer: 'Hummel' })).toBeUndefined();
  });

  it('ignores a tempo stored as something other than a number', () => {
    expect(settledTempo({ tempo_bpm: '72' })).toBeUndefined();
    expect(settledTempo({ tempo_bpm: null })).toBeUndefined();
  });

  it('bounds a stored tempo — a hand-edited row cannot hand the dock a 4000', () => {
    expect(settledTempo({ tempo_bpm: 4000 })).toEqual({ bpm: 240, meter: 4 });
  });

  it('defaults only the meter, never the tempo', () => {
    expect(settledTempo({ tempo_bpm: 60 })).toEqual({ bpm: 60, meter: 4 });
  });

  it('round-trips through the patch it writes', () => {
    expect(settledTempo(tempoMeta({ bpm: 88, meter: 6 }))).toEqual({ bpm: 88, meter: 6 });
    expect(Object.keys(tempoMeta({ bpm: 88, meter: 6 }))).toContain(TEMPO_BPM_KEY);
  });
});

describe('renderRepertoire tells the coach the tempo', () => {
  it('names the settled tempo on the item line', () => {
    const out = renderRepertoire([item('Écossaise (Hummel)', { meta: { tempo_bpm: 72 } })]);
    expect(out).toContain('settled tempo 72 bpm');
  });

  it('names an unusual meter but stays quiet about the common one', () => {
    expect(renderRepertoire([item('Waltz', { meta: { tempo_bpm: 90, tempo_meter: 3 } })])).toContain(
      'settled tempo 90 bpm, 3 to the bar',
    );
    const common = renderRepertoire([item('Study', { meta: { tempo_bpm: 90, tempo_meter: 4 } })]);
    expect(common).toContain('settled tempo 90 bpm');
    expect(common).not.toContain('to the bar');
  });

  it('says nothing at all for an item with no tempo on file', () => {
    expect(renderRepertoire([item('Minuet')])).not.toContain('settled tempo');
  });

  it('keeps the tempo alongside the other facts on the line', () => {
    const out = renderRepertoire([item('Solo', { kind: 'piece', meta: { tempo_bpm: 66 } })]);
    expect(out).toContain('- Solo (piece; not worked yet while on file; settled tempo 66 bpm)');
  });
});

/**
 * The practice note on the coach's own line (owner ruling 2026-09-03). It was already stored (P8)
 * and already on the row's second line on the screen and in the prescribe facts — this render was
 * the one place holding it back, so she could read "Hungarian Folk Song, worked yesterday" without
 * the "bars 9-16" that says what worked on it means. A fact she has is a fact she can reason from;
 * the alternative was her guessing where in a piece the work is.
 */
describe('renderRepertoire carries the practice note', () => {
  it('names the note on the item line, after the facts already there', () => {
    const out = renderRepertoire([
      item('Hungarian Folk Song', {
        kind: 'piece',
        meta: { tempo_bpm: 66, [PRACTICE_NOTE_KEY]: 'bars 9-16' },
      }),
    ]);
    expect(out).toContain('settled tempo 66 bpm; note: bars 9-16)');
  });

  it('carries a note on a row that holds nothing else — a kata or a verse rarely has a tempo', () => {
    const out = renderRepertoire([
      item('Heian Shodan', { kind: 'kata', meta: { [PRACTICE_NOTE_KEY]: 'for 5th kyu' } }),
    ]);
    expect(out).toContain('- Heian Shodan (kata; not worked yet while on file; note: for 5th kyu)');
  });

  it('says nothing at all when there is no note on file — never an empty "note:"', () => {
    expect(renderRepertoire([item('Minuet', { meta: { tempo_bpm: 66 } })])).not.toContain('note:');
    expect(renderRepertoire([item('Minuet')])).not.toContain('note:');
  });

  it('drops a blank note the way every other qualifier string is dropped', () => {
    expect(renderRepertoire([item('Minuet', { meta: { [PRACTICE_NOTE_KEY]: '   ' } })])).not.toContain('note:');
  });
});
