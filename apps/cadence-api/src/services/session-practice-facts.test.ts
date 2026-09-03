/**
 * The practice session reads the shelf — and nothing here ranks it.
 *
 * Until 2026-09-03 this module made the session's choices: it computed the warm-up (the Keeping up
 * item rested longest), the swap, a capped Learning list, and the top of Up next, and the prompt
 * told her to use exactly those. The owner ruled that out — *"We don't need to give the coach ANY
 * direction on how to pick... We continue to try to influence or bias the LLM's natural reasoning,
 * but we shouldn't."* So it now hands over the whole shelf as facts and she chooses.
 *
 * That makes the load-bearing assertion in this file a NEGATIVE one: no line and no word ranks one
 * item above another. It is a silent failure otherwise — a variable that quietly says "start here"
 * still renders a plausible session, and nothing throws. The rest is the line's own shape, on the
 * real Suzuki Book 2 shelf (the one that actually collides).
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
 * Book 2 under the four standings. The rests are deliberately uneven — one never worked, one worked
 * weeks ago, one worked days ago — because the old code turned exactly that into a pick, and the
 * negative assertions below have to be able to see a pick if one comes back.
 */
const SHELF: RepertoireLike[] = [
  // Keeping up (known).
  item(ECOSSAISE, 'known', { last_practiced_at: null }),
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
  // Learned (retired).
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

const lineFor = (text: string, label: string): string => text.split('\n').find((l) => l.startsWith(`- ${label}`)) ?? '';

describe('practiceFacts — the whole shelf, one line per item', () => {
  it('lists every item on the shelf, whatever its standing', () => {
    const facts = practiceFacts(SHELF, []);
    expect(facts.items).toHaveLength(SHELF.length);
    expect(facts.items.map((i) => i.label).sort()).toEqual(SHELF.map((i) => i.label).sort());
  });

  it("keeps the shelf's own order — it never re-sorts into an order that reads as a ranking", () => {
    expect(practiceFacts(SHELF, []).items.map((i) => i.label)).toEqual(SHELF.map((i) => i.label));
  });

  it('gives nothing at all for an empty shelf', () => {
    expect(practiceFacts([], []).items).toEqual([]);
  });
});

describe('practiceFacts — the facts on one line', () => {
  const text = (): string => practiceVariables(SHELF, LOGS).repertoire;

  it('names the standing by the word the person sees on their own screen', () => {
    expect(lineFor(text(), FOLK_SONG)).toContain('Learning');
    expect(lineFor(text(), ARIETTA)).toContain('Keeping up');
    expect(lineFor(text(), MELODY)).toContain('Up next');
    expect(lineFor(text(), CRADLE_SONG)).toContain('Learned');
  });

  it('dates the last practice, and says "never" rather than leaving the segment off', () => {
    expect(lineFor(text(), ARIETTA)).toContain('last practised 2026-08-20');
    expect(lineFor(text(), ECOSSAISE)).toContain('last practised never');
  });

  it('carries the settled tempo, with the meter only when it is not the common 4', () => {
    expect(lineFor(text(), FOLK_SONG)).toContain('settled tempo 66 bpm, 3 to the bar');
    expect(lineFor(text(), ARIETTA)).not.toContain('settled tempo');
    const common = practiceVariables([item('Study', 'working', { meta: { [TEMPO_BPM_KEY]: 90 } })], []).repertoire;
    expect(common).toContain('settled tempo 90 bpm');
    expect(common).not.toContain('to the bar');
  });

  it('carries the stored practice note and the position in a collection', () => {
    expect(lineFor(text(), FOLK_SONG)).toContain('note: bars 9–16');
    expect(lineFor(text(), FOLK_SONG)).toContain('rank 9');
  });

  it('leaves out every segment there is no fact for — never an empty label', () => {
    const bare = practiceVariables([item('Arietta', 'known')], []).repertoire;
    expect(lineFor(bare, 'Arietta')).toBe('- Arietta · Keeping up · last practised never');
  });

  it('states what the four standings mean, including the one boundary that is not a picking rule', () => {
    const out = text();
    expect(out).toContain('Never start one unless they ask');
    for (const meaning of ['being worked on now', 'learned and still played', 'finished; not played any more']) {
      expect(out).toContain(meaning);
    }
  });
});

/**
 * The person's own words are a FACT about the item, so they survived the ruling — and they now
 * reach every item rather than only the ones code had picked as "Learning". The shelf-wide
 * shared-needle rule still applies: a mention that could be either of two pieces decides neither.
 */
describe('practiceFacts — the words of the most recent log that names a piece', () => {
  it('quotes the newest log naming the piece, with its date', () => {
    const line = lineFor(practiceVariables(SHELF, LOGS).repertoire, FOLK_SONG);
    expect(line).toContain('last words 2026-08-31');
    expect(line).toContain('left hand still stumbles at bar 13');
  });

  it('carries how it felt when a logged item names the piece', () => {
    expect(lineFor(practiceVariables(SHELF, LOGS).repertoire, FOLK_SONG)).toContain('hard');
  });

  it('reaches a Keeping up item too — the words are no longer only for what code called Learning', () => {
    expect(lineFor(practiceVariables(SHELF, LOGS).repertoire, HAPPY_FARMER)).toContain('last words 2026-08-28');
  });

  it('says nothing rather than the wrong thing when no log names the piece', () => {
    const other: PracticeLogRow[] = [
      { date: '2026-08-31', log: { summary: 'scales and arpeggios', raw_text: 'scales only today', items: [] } },
    ];
    expect(practiceVariables(SHELF, other).repertoire).not.toContain('last words');
  });

  it('refuses a log whose title names two pieces on this shelf', () => {
    const minuets = [
      item('Minuet in G Major, BWV 822', 'working'),
      item('Minuet in G Major (from Notebook for Anna Magdalena Bach)', 'working'),
    ];
    const logs: PracticeLogRow[] = [
      { date: '2026-08-31', log: { summary: 'worked the Minuet in G Major', raw_text: '', items: [] } },
    ];
    expect(practiceVariables(minuets, logs).repertoire).not.toContain('last words');
  });
});

/**
 * THE RULING, as a table (owner 2026-09-03). Each row is a phrase that shipped in this variable or
 * the prompt reading it, and each one told her which item to reach for. A near-miss matters here
 * more than a positive: the facts can all be correct and the variable still be a set of orders.
 */
describe('practiceVariables — no line and no word ranks one item above another', () => {
  const RANKING_WORDS = [
    /due next/i,
    /longest rest/i,
    /rested longest/i,
    /rotation/i,
    /warm-?up/i,
    /play-?out/i,
    /start (?:here|with)/i,
    /propose the top/i,
    /keep it to one/i,
    /never schedule/i,
    /\bfirst\b/i,
    /\bpick\b/i,
    /\bchoose\b/i,
  ];

  it('carries none of the words the old variables used to rank the shelf', () => {
    const out = practiceVariables(SHELF, LOGS).repertoire;
    for (const re of RANKING_WORDS) {
      expect(out, `"${re}" ranks the shelf for her`).not.toMatch(re);
    }
  });

  it('marks no item — every line has the same shape as every other', () => {
    const lines = practiceVariables(SHELF, LOGS)
      .repertoire.split('\n')
      .filter((l) => l.startsWith('- '));
    expect(lines).toHaveLength(SHELF.length);
    for (const line of lines) expect(line).toMatch(/^- .+ · (Learning|Up next|Keeping up|Learned) · last practised /);
  });

  it('hands back ONE variable — the four that named picks are gone', () => {
    expect(Object.keys(practiceVariables(SHELF, LOGS))).toEqual(['repertoire']);
  });
});

describe('practiceVariables — the bounds', () => {
  it('is empty for a goal with no repertoire — the template ignores an empty tag', () => {
    expect(practiceVariables([], [])).toEqual({ repertoire: '' });
  });

  it('is empty when the shelf could not be read — never a claim that there is nothing', () => {
    expect(practiceVariables(null, LOGS)).toEqual({ repertoire: '' });
  });

  /**
   * The one cap, and it is on Learned only (owner ruling 2026-09-03). Learning, Up next and Keeping
   * up are what a session is built from, so a cut there hides live material; Learned only grows.
   * Same rule, same twelve, same wording as the chat render — both read `cappedLearned` and
   * `learnedTotalLine` from `@cadence/shared`, so the two can never disagree about which twelve.
   */
  it('sends Learning, Up next and Keeping up in full', () => {
    for (const status of ['working', 'queued', 'known'] as const) {
      const many = Array.from({ length: 60 }, (_, n) => item(`Study ${n + 1}`, status));
      const out = practiceVariables(many, []).repertoire;
      expect(out.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(60);
    }
  });

  it('shows the 12 most recently touched Learned items and states the total', () => {
    const many = Array.from({ length: 214 }, (_, n) =>
      item(`Study ${String(n).padStart(3, '0')}`, 'retired', { learned_at: `2026-0${1 + (n % 8)}-01T00:00:00.000Z` }),
    );
    const out = practiceVariables(many, []).repertoire;
    expect(out).toContain('Learned: 214 items — 12 most recent shown');
    expect(out.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(12);
  });

  it('counts the day it was finished as a practice when ranking Learned', () => {
    const out = practiceVariables(
      [
        item('old finish, played last week', 'retired', {
          learned_at: '2019-01-01T00:00:00.000Z',
          last_practiced_at: '2026-08-27T00:00:00.000Z',
        }),
        item('recent finish, untouched', 'retired', { learned_at: '2026-07-01T00:00:00.000Z' }),
      ],
      [],
    ).repertoire;
    const lines = out.split('\n').filter((l) => l.startsWith('- '));
    expect(lines[0]).toContain('old finish, played last week');
    expect(lines[1]).toContain('recent finish, untouched');
  });

  it('states the total without a "shown" clause when Learned fits', () => {
    const out = practiceVariables(
      [item('Cradle Song', 'retired', { learned_at: '2026-01-01T00:00:00.000Z' })],
      [],
    ).repertoire;
    expect(out).toContain('Learned: 1 item');
    expect(out).not.toContain('most recent shown');
  });
});
