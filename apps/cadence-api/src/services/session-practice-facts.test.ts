/**
 * The practice session reads the standings.
 *
 * Thursday's practice is the shelf's shape read back: the warm-up comes from Keeping up (rested
 * longest), the learn part from Learning, the play-out from Keeping up, Up next appears only as a
 * forecast, and Learned is never scheduled. Code decides WHICH items those are; the coach still
 * writes the session.
 *
 * Every rule below is a silent failure if it breaks — a wrong warm-up is a valid session that is
 * simply not the one the standings called for, and nothing throws. So each has a positive case and
 * a near-miss, on the real Suzuki Book 2 shelf (the one that actually collides).
 */
import { describe, expect, it } from 'vitest';
import { PRACTICE_NOTE_KEY, RANK_KEY, TEMPO_BPM_KEY, TEMPO_METER_KEY, type RepertoireLike } from '@cadence/shared';
import { practiceFacts, practiceVariables, type PracticeLogRow } from './session-practice-facts.ts';

const item = (
  label: string,
  status: RepertoireLike['status'],
  extra: Partial<RepertoireLike> = {},
): RepertoireLike => ({
  label,
  status,
  kind: 'piece',
  started_at: '2026-06-01T00:00:00.000Z',
  last_practiced_at: null,
  ...extra,
});

const ECOSSAISE = 'Écossaise (Hummel)';
const SHORT_STORY = 'A Short Story (Lichner)';
const HAPPY_FARMER = 'The Happy Farmer (from Album for the Young, Op. 68, No. 10)';
const ARIETTA = 'Arietta';
const FOLK_SONG = 'Hungarian Folk Song (from For Children, Sz. 42)';
const MELODY = 'Melody (from Album for the Young, Op. 68, No. 1)';
const SONATINA = 'Sonatina in G Major, Anh. 5 (Moderato, Romance)';
const CRADLE_SONG = 'Cradle Song, Op. 13, No. 2';

/**
 * Book 2 under the four standings. The rests are deliberately ordered so that the item resting
 * longest OVERALL is retired and the second-longest is queued — if either group were eligible, the
 * warm-up would come back wrong rather than empty.
 */
const SHELF: RepertoireLike[] = [
  // Keeping up (known) — the rotation pool.
  item(ECOSSAISE, 'known', { last_practiced_at: null }), // never worked ⇒ rests longest of the known
  item(ARIETTA, 'known', { last_practiced_at: '2026-08-20T18:00:00.000Z' }),
  item(SHORT_STORY, 'known', { last_practiced_at: '2026-08-25T18:00:00.000Z' }),
  item(HAPPY_FARMER, 'known', { last_practiced_at: '2026-08-30T18:00:00.000Z' }),
  // Learning (working).
  item(FOLK_SONG, 'working', {
    last_practiced_at: '2026-08-31T18:00:00.000Z',
    meta: { [TEMPO_BPM_KEY]: 66, [TEMPO_METER_KEY]: 3, [RANK_KEY]: 9, [PRACTICE_NOTE_KEY]: 'bars 9–16' },
  }),
  // Up next (queued), in the user's ladder order.
  item(MELODY, 'queued', { meta: { [RANK_KEY]: 10 } }),
  item(SONATINA, 'queued', { meta: { [RANK_KEY]: 11 } }),
  // Learned (retired) — never worked, so it would win any rotation that let it in.
  item(CRADLE_SONG, 'retired', { last_practiced_at: null, started_at: '2026-01-01T00:00:00.000Z' }),
];

const LOGS: PracticeLogRow[] = [
  {
    date: '2026-08-31',
    log: {
      summary: 'Twenty minutes at the piano; the folk song is coming along',
      raw_text: 'ran the Hungarian Folk Song a few times, left hand still stumbles at bar 13',
      items: [{ name: 'Hungarian Folk Song', felt: 'hard' }],
    },
  },
  {
    date: '2026-08-28',
    log: {
      summary: 'Played the Happy Farmer and the folk song',
      raw_text: 'happy farmer twice, then the hungarian folk song',
      items: [],
    },
  },
];

describe('practiceFacts — the warm-up is the rotation, not a guess', () => {
  it('picks the Keeping up item resting longest', () => {
    expect(practiceFacts(SHELF, []).warmup_pick?.label).toBe(ECOSSAISE);
  });

  it('offers the NEXT-rested for a swap, not any other item', () => {
    expect(practiceFacts(SHELF, []).next_rested?.label).toBe(ARIETTA);
  });

  it('never promotes from Up next when Keeping up is empty', () => {
    const noKnown = SHELF.filter((i) => i.status !== 'known');
    const facts = practiceFacts(noKnown, []);
    expect(facts.warmup_pick).toBeNull();
    expect(facts.next_rested).toBeNull();
  });

  it('never takes the warm-up from Learned, even when it has rested longest of all', () => {
    // Cradle Song is retired and has never been worked; only 'known' may be picked.
    expect(practiceFacts(SHELF, []).warmup_pick?.label).not.toBe(CRADLE_SONG);
    expect(practiceFacts(SHELF, []).next_rested?.label).not.toBe(CRADLE_SONG);
  });

  it('never takes the warm-up from Learning', () => {
    const facts = practiceFacts(SHELF, []);
    expect(facts.warmup_pick?.label).not.toBe(FOLK_SONG);
    expect(facts.next_rested?.label).not.toBe(FOLK_SONG);
  });

  it('offers no swap when the rotation holds exactly one item', () => {
    const one = [item(ARIETTA, 'known'), item(FOLK_SONG, 'working'), item(CRADLE_SONG, 'retired')];
    const facts = practiceFacts(one, []);
    expect(facts.warmup_pick?.label).toBe(ARIETTA);
    expect(facts.next_rested).toBeNull();
  });

  it('gives nothing at all for an empty shelf', () => {
    const facts = practiceFacts([], []);
    expect(facts.warmup_pick).toBeNull();
    expect(facts.next_rested).toBeNull();
    expect(facts.learning).toEqual([]);
    expect(facts.up_next_top).toBeNull();
  });
});

describe('practiceFacts — Learning carries the note and the last words', () => {
  it('lists only the working items', () => {
    expect(practiceFacts(SHELF, LOGS).learning.map((l) => l.label)).toEqual([FOLK_SONG]);
  });

  it("renders the piece's own practice note from what the row holds", () => {
    const [learning] = practiceFacts(SHELF, LOGS).learning;
    expect(learning?.practice_note).toContain('settled tempo 66 bpm');
    expect(learning?.practice_note).toContain('3 to the bar');
  });

  it('leaves the practice note empty when the row holds nothing to say', () => {
    const bare = [item('Arietta', 'working')];
    expect(practiceFacts(bare, []).learning[0]?.practice_note).toBe('');
  });

  it('a stored practice note (P8) leads the line, ahead of the settled tempo and the rank', () => {
    const [learning] = practiceFacts(SHELF, LOGS).learning;
    expect(learning?.practice_note).toBe('bars 9–16 · settled tempo 66 bpm, 3 to the bar; rank: 9');
  });

  it('a note with nothing else on the row is the whole practice note, with no dangling separator', () => {
    const notedOnly = [item('Arietta', 'working', { meta: { [PRACTICE_NOTE_KEY]: 'first stanza' } })];
    expect(practiceFacts(notedOnly, []).learning[0]?.practice_note).toBe('first stanza');
  });

  it('quotes the most recent log that names the piece, with its date', () => {
    const [learning] = practiceFacts(SHELF, LOGS).learning;
    expect(learning?.last_words?.date).toBe('2026-08-31');
    expect(learning?.last_words?.words).toContain('left hand still stumbles at bar 13');
  });

  it('carries how it felt when a logged item names the piece', () => {
    expect(practiceFacts(SHELF, LOGS).learning[0]?.last_words?.words).toContain('hard');
  });

  it('says nothing rather than the wrong thing when no log names the piece', () => {
    const other: PracticeLogRow[] = [
      { date: '2026-08-31', log: { summary: 'scales and arpeggios', raw_text: 'scales only today', items: [] } },
    ];
    expect(practiceFacts(SHELF, other).learning[0]?.last_words).toBeNull();
  });

  it('refuses a log whose title names two pieces on this shelf', () => {
    // The core needle of both minuets is the same; a bare mention decides nothing.
    const minuets = [
      item('Minuet in G Major, BWV 822', 'working'),
      item('Minuet in G Major (from Notebook for Anna Magdalena Bach)', 'working'),
    ];
    const logs: PracticeLogRow[] = [
      { date: '2026-08-31', log: { summary: 'worked the Minuet in G Major', raw_text: '', items: [] } },
    ];
    expect(practiceFacts(minuets, logs).learning.every((l) => l.last_words === null)).toBe(true);
  });
});

describe('practiceFacts — Up next is a forecast only', () => {
  it('names the lowest-rank queued item', () => {
    expect(practiceFacts(SHELF, []).up_next_top?.label).toBe(MELODY);
  });

  it('never names an item from another standing', () => {
    const top = practiceFacts(SHELF, []).up_next_top;
    expect(top?.status).toBe('queued');
  });

  it("keeps the user's own order when the shelf carries no ranks", () => {
    const unranked = [item(SONATINA, 'queued'), item(MELODY, 'queued')];
    expect(practiceFacts(unranked, []).up_next_top?.label).toBe(SONATINA);
  });

  it('puts a ranked item ahead of an unranked one', () => {
    const mixed = [item(SONATINA, 'queued'), item(MELODY, 'queued', { meta: { [RANK_KEY]: 10 } })];
    expect(practiceFacts(mixed, []).up_next_top?.label).toBe(MELODY);
  });

  it('is null when nothing is queued', () => {
    expect(
      practiceFacts(
        SHELF.filter((i) => i.status !== 'queued'),
        [],
      ).up_next_top,
    ).toBeNull();
  });
});

describe('practiceVariables — what the prompt is handed', () => {
  it('names each pick and lists Learning with its note and last words', () => {
    const vars = practiceVariables(SHELF, LOGS);
    expect(vars.warmup_pick).toContain(ECOSSAISE);
    expect(vars.next_rested).toContain(ARIETTA);
    expect(vars.up_next_top).toContain(MELODY);
    expect(vars.learning).toContain(FOLK_SONG);
    expect(vars.learning).toContain('settled tempo 66 bpm');
    expect(vars.learning).toContain('left hand still stumbles at bar 13');
  });

  it('never leaks Learned or Up next into a part of the session', () => {
    const vars = practiceVariables(SHELF, LOGS);
    for (const v of [vars.warmup_pick, vars.next_rested, vars.learning]) {
      expect(v).not.toContain(CRADLE_SONG);
      expect(v).not.toContain(MELODY);
      expect(v).not.toContain(SONATINA);
    }
  });

  it('says plainly that nothing has been logged about a piece yet', () => {
    const vars = practiceVariables([item(FOLK_SONG, 'working')], []);
    expect(vars.learning).toContain('no words logged');
  });

  it('is empty for a goal with no repertoire — the template ignores an empty tag', () => {
    expect(practiceVariables([], [])).toEqual({ warmup_pick: '', next_rested: '', learning: '', up_next_top: '' });
  });

  it('is empty when the shelf could not be read — never a claim that there is nothing', () => {
    expect(practiceVariables(null, LOGS)).toEqual({ warmup_pick: '', next_rested: '', learning: '', up_next_top: '' });
  });

  it('says how many Learning items it left out rather than truncating in silence', () => {
    const many = Array.from({ length: 6 }, (_, n) => item(`Study ${n + 1}`, 'working'));
    const vars = practiceVariables(many, []);
    expect(vars.learning).toContain('2 more in Learning');
  });
});
