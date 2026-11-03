/**
 * The session checker's rules, each as a table of positives (the real stored shapes from the
 * 2026-11-02 audit) and near-misses (real shapes that must produce NO finding). A rule that
 * decides which steps go back to the coach fails silently when it is wrong — a tempo cue read as
 * a timed effort would send a correct 12-rep bridge back for "repair" on every session.
 */
import { describe, expect, it } from 'vitest';
import type { SessionBlock, SessionItem } from './types/occurrence.ts';
import {
  checkSession,
  countPhraseIn,
  renderCheckFindings,
  timePhraseIn,
  type SessionCheckRule,
} from './session-check.ts';
import { BLOCK_LABEL_MAX, ITEM_DETAIL_MAX, ITEM_LOAD_MAX, ITEM_NAME_MAX } from './session-limits.ts';

const session = (items: SessionItem[], block: Partial<SessionBlock> = {}) => ({
  blocks: [{ label: 'Main', items, ...block }],
});
const rulesOf = (items: SessionItem[], block: Partial<SessionBlock> = {}): SessionCheckRule[] =>
  checkSession(session(items, block)).map((f) => f.rule);

/** The farmer carry from the owner's 2026-11-02 session, exactly as stored. */
const carryAsReps: SessionItem = {
  name: 'Farmer carries',
  tool: 'reps',
  sets: 4,
  reps: 1,
  load: '2 x 40 lb kettlebells',
  detail: 'Each set is one carry of about 40 m, or 40-45 seconds of walking. Stand tall with your shoulders down.',
};

describe('checkSession — every rule as a table', () => {
  const ROWS: Array<[string, SessionItem, Partial<SessionBlock>, SessionCheckRule[]]> = [
    // ── timer_no_time (error): the two Sep 6 holds, tool timer with sets and no time.
    [
      'a timer with sets and no duration_min → timer_no_time',
      { name: 'Isometric forearm hold', tool: 'timer', sets: 2, load: 'light', detail: 'press for 20 sec each arm' },
      {},
      ['timer_no_time'],
    ],
    ['a bare timer with no time at all → timer_no_time', { name: 'Wall sit', tool: 'timer' }, {}, ['timer_no_time']],
    ['a plain 1-minute plank → nothing', { name: 'Plank', tool: 'timer', duration_min: 1 }, {}, []],
    [
      'a timed-sets carry (sets 4, duration_min 0.75, no reps) → nothing: that is the Phase 2 shape',
      { name: 'Farmer carry', tool: 'timer', sets: 4, duration_min: 0.75, load: '2 × 40 lb', rest_sec: 60 },
      {},
      [],
    ],
    [
      'timed sets with no rest_sec → nothing: rest is undrawn and optional',
      { name: 'Dead hang', tool: 'timer', sets: 3, duration_min: 0.5 },
      {},
      [],
    ],
    ['timed sets inferred (no tool) → nothing', { name: 'Plank', sets: 3, duration_min: 0.5 }, {}, []],
    // ── one_rep_sets (question): the carry, the hang, the elbow hold.
    ['the owner’s carry: reps 1, sets 4, time in the cue → one_rep_sets', carryAsReps, {}, ['one_rep_sets']],
    [
      'the Aug 31 elbow hold: reps 1, sets 2 → one_rep_sets',
      { name: 'Elbow isometric hold', tool: 'reps', sets: 2, reps: 1, detail: 'hold steady for ~20 seconds' },
      {},
      ['one_rep_sets'],
    ],
    [
      'a carry with no time in the cue at all → still one_rep_sets (the cue may or may not mention time)',
      { name: 'Farmer carry', tool: 'reps', sets: 3, reps: 1, detail: 'about 20m and back, upright posture' },
      {},
      ['one_rep_sets'],
    ],
    ['reps 0 in sets → one_rep_sets', { name: 'Hang', sets: 3, reps: 0 }, {}, ['one_rep_sets']],
    [
      'a single max-effort set (sets 1, reps 1) → nothing',
      { name: 'Max strict pull-ups', tool: 'reps', sets: 1, reps: 1, detail: 'one set, stop one rep shy of failure' },
      {},
      [],
    ],
    [
      '"pause 2 seconds at the top" on a 12-rep bridge → nothing: a tempo cue is not a timed effort',
      { name: 'Glute bridge', tool: 'reps', sets: 2, reps: 12, detail: 'pause 2 seconds at the top' },
      {},
      [],
    ],
    [
      '"lower over 3 seconds" on a step-down → nothing',
      {
        name: 'Low step-down',
        tool: 'reps',
        sets: 3,
        reps: 8,
        detail: '8 per leg; lower over 3 seconds and tap lightly',
      },
      {},
      [],
    ],
    ['sets with no reps (an AMRAP set) → nothing', { name: 'Max pull-ups', tool: 'reps', sets: 2 }, {}, []],
    // ── checkoff_counts (question): the Nov 8 "3 x 40 m" carry and the Sep 3 four-set carry.
    [
      'a check-off whose cue counts carries → checkoff_counts',
      {
        name: 'Farmer carries, 3 x 40 m',
        tool: 'checkoff',
        distance_km: 0.12,
        detail: 'Do 3 carries of about 40 m, resting 60 seconds between.',
      },
      {},
      ['checkoff_counts'],
    ],
    [
      'a check-off with sets 4 → checkoff_counts',
      { name: 'Farmer carry', tool: 'checkoff', sets: 4, distance_km: 0.02, detail: 'walk tall for about 20m' },
      {},
      ['checkoff_counts'],
    ],
    [
      'a check-off counting "3 short trips" → checkoff_counts',
      { name: 'Light farmer carry', tool: 'checkoff', detail: '3 short trips of about 20m, dumbbells at your sides' },
      {},
      ['checkoff_counts'],
    ],
    [
      'a check-off counting "two sets" in words → checkoff_counts',
      { name: 'Band pull-aparts', tool: 'checkoff', detail: 'two sets of easy pull-aparts' },
      {},
      ['checkoff_counts'],
    ],
    [
      'a knee check-in that mentions "the carries" with no count → nothing',
      { name: 'Knee check-in', tool: 'checkoff', detail: 'How did the left knee feel through the carries and slams?' },
      {},
      [],
    ],
    ['a 3-minute brisk walk check-off → nothing', { name: 'Brisk walk', tool: 'checkoff', duration_min: 3 }, {}, []],
    ['a 3 km shakeout jog → nothing', { name: 'Easy shakeout jog', tool: 'checkoff', distance_km: 3 }, {}, []],
    [
      'a check-off with sets 1 → nothing',
      { name: 'Quad and calf stretch', tool: 'checkoff', sets: 1, detail: '30 seconds each side, gentle' },
      {},
      [],
    ],
    [
      'a check-off saying "one set" → nothing: one is not a count the app would play',
      { name: 'Easy row', tool: 'checkoff', detail: 'one set, easy pace' },
      {},
      [],
    ],
    // ── reps_no_sets (question): the leg-swing warm-ups.
    [
      'reps with no sets in a straight block → reps_no_sets',
      { name: 'Gentle leg swings', tool: 'checkoff', reps: 10, detail: 'small swings each leg' },
      {},
      ['reps_no_sets'],
    ],
    [
      'reps with no sets, tool reps → reps_no_sets',
      { name: 'Leg swings', tool: 'reps', reps: 10 },
      {},
      ['reps_no_sets'],
    ],
    [
      'reps with no sets inside a circuit → nothing: the rounds carry the count',
      { name: 'Push-ups', reps: 10 },
      { mode: 'circuit', rounds: 3 },
      [],
    ],
    ['reps with sets → nothing', { name: 'Press', tool: 'reps', sets: 3, reps: 10 }, {}, []],
    ['no reps, no sets (a read) → nothing', { name: 'Settle in', tool: 'read', detail: 'Find a seat' }, {}, []],
  ];

  it.each(ROWS)('%s', (_name, item, block, expected) => {
    expect(rulesOf([item], block)).toEqual(expected);
  });

  it('a timer with no time keeps its severity: error; the one-rep carry is a question', () => {
    const [timer] = checkSession(session([{ name: 'Wall sit', tool: 'timer', sets: 2 }]));
    expect(timer?.severity).toBe('error');
    const [carry] = checkSession(session([carryAsReps]));
    expect(carry?.severity).toBe('question');
  });

  it('the fact for the owner’s carry names the step, the numbers and the time in the cue', () => {
    const [carry] = checkSession({
      blocks: [
        { label: 'Warm-up', items: [{ name: 'Row' }] },
        { label: 'Main', items: [{ name: 'Press', sets: 3, reps: 8 }, carryAsReps] },
      ],
    });
    expect(carry).toMatchObject({ rule: 'one_rep_sets', blockIndex: 1, itemIndex: 1, item: 'Farmer carries' });
    expect(carry?.fact).toBe(
      "block 2 item 2 'Farmer carries': tool reps, reps 1, sets 4; its detail says '40-45 seconds of walking'.",
    );
  });

  it('a timer with no time says what the app does with it, and quotes the cue’s time', () => {
    const [f] = checkSession(
      session([{ name: 'Isometric forearm hold', tool: 'timer', sets: 2, detail: 'press for 20 sec each arm' }]),
    );
    expect(f?.fact).toBe(
      "block 1 item 1 'Isometric forearm hold': tool timer with no duration_min, sets 2, so the app plays one minute; its detail says '20 sec each arm'.",
    );
  });
});

describe('checkSession — circuit blocks', () => {
  it('a circuit with no rounds is an error that says what the app will play instead', () => {
    const found = checkSession({
      blocks: [
        {
          label: 'Finisher',
          mode: 'circuit',
          items: [
            { name: 'Swing', sets: 3, reps: 15 },
            { name: 'Plank', duration_min: 0.5 },
          ],
        },
      ],
    });
    expect(found).toEqual([
      {
        rule: 'circuit_no_rounds',
        blockIndex: 0,
        itemIndex: null,
        item: 'Finisher',
        severity: 'error',
        fact: "block 1 'Finisher': mode circuit with no rounds, so the app plays 3 rounds, the largest sets count on its items.",
      },
    ]);
  });

  it('a circuit with rounds, and a straight block, produce nothing', () => {
    expect(rulesOf([{ name: 'Swing', reps: 15 }], { mode: 'circuit', rounds: 3 })).toEqual([]);
    expect(rulesOf([{ name: 'Swing', sets: 3, reps: 15 }], { mode: 'straight' })).toEqual([]);
  });
});

describe('checkSession — text the app cut or would cut', () => {
  const long = (n: number) => 'word '.repeat(Math.ceil(n / 5)).slice(0, n);

  it('text over the limit is an error, per field, with the limit named', () => {
    const found = checkSession({
      blocks: [
        {
          label: long(BLOCK_LABEL_MAX + 1),
          items: [{ name: long(ITEM_NAME_MAX + 1), load: long(ITEM_LOAD_MAX + 1), detail: long(ITEM_DETAIL_MAX + 1) }],
        },
      ],
    });
    expect(found.map((f) => [f.rule, f.severity, f.itemIndex])).toEqual([
      ['text_cut', 'error', null],
      ['text_cut', 'error', 0],
      ['text_cut', 'error', 0],
      ['text_cut', 'error', 0],
    ]);
    expect(found[3]?.fact).toContain(
      `its detail is ${ITEM_DETAIL_MAX + 1} characters; the app keeps ${ITEM_DETAIL_MAX}`,
    );
  });

  it('text ending with the app’s "…" near the limit is a question: it was probably cut', () => {
    const cut = `${long(ITEM_DETAIL_MAX - 20)}…`;
    const [f] = checkSession(session([{ name: 'Press', detail: cut }]));
    expect(f).toMatchObject({ rule: 'text_cut', severity: 'question' });
    expect(f?.fact).toContain(`ends with '…' at ${cut.length} characters`);
  });

  it('a short cue that happens to end with "…", and text at the limit, produce nothing', () => {
    expect(rulesOf([{ name: 'Settle in', detail: 'Breathe out slowly…' }])).toEqual([]);
    expect(rulesOf([{ name: 'Press', detail: long(ITEM_DETAIL_MAX) }])).toEqual([]);
    // A 200-character cue cut under the OLD limit, mid-word with no "…" (353 stored rows) is not reported.
    expect(rulesOf([{ name: 'Press', detail: long(200) }])).toEqual([]);
  });
});

describe('the phrases the facts quote', () => {
  it.each([
    ['Each set is one carry of about 40 m, or 40-45 seconds of walking.', '40-45 seconds of walking'],
    ['Gentle wrist extension press, 20 sec each arm, low effort only', '20 sec each arm'],
    ['Hang for about 20 s and stop short of failure', '20 s'],
    ['Rest 60 s between carries', '60 s between carries'],
    ['Hold 5 min', '5 min'],
    ['Do 2 sets of 10', null],
    ['Rate it 0-10', null],
  ])('time in %j → %j', (text, phrase) => {
    expect(timePhraseIn(text)).toBe(phrase);
  });

  it.each([
    ['Do 3 carries of about 40 m', '3 carries'],
    ['3 short trips of about 20m', '3 short trips'],
    ['two sets of easy pull-aparts', 'two sets'],
    ['four rounds, easy pace', 'four rounds'],
    ['How did the knee feel through the carries', null],
    ['one set, easy pace', null],
    ['Walk about 30 m, 100 ft', null],
  ])('count in %j → %j', (text, phrase) => {
    expect(countPhraseIn(text)).toBe(phrase);
  });
});

describe('renderCheckFindings', () => {
  it('renders one line per finding with the severity in front, and nothing for a clean session', () => {
    const found = checkSession(session([carryAsReps, { name: 'Wall sit', tool: 'timer', sets: 2 }]));
    expect(renderCheckFindings(found)).toBe(
      "- (question) block 1 item 1 'Farmer carries': tool reps, reps 1, sets 4; its detail says '40-45 seconds of walking'.\n" +
        "- (error) block 1 item 2 'Wall sit': tool timer with no duration_min, sets 2, so the app plays one minute; its detail names no time.",
    );
    expect(renderCheckFindings([])).toBe('');
  });
});
