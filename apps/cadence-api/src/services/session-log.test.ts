/**
 * Revising a log must not erase it.
 *
 * `log_session`'s own description invites revision — "use it again to REVISE something already
 * logged when they add or correct it later" — but the write replaces log/value/provenance
 * wholesale and the numbers came only from parsing the NEW sentence. So "oh, and it was pouring
 * the whole way", two minutes after "8k in 44 minutes, HR 152", parsed to no numbers and stored
 * `{}`: adding a detail erased the record.
 *
 * The fix is deliberately NOT a merge in code. `{...prior, ...next}` keeps the run's 8k on
 * "scratch that, I biked instead", which turns the record into a confident lie — and nothing in
 * the text tells a spread operator which of the two it is reading. The parse is already a model
 * call, so the prior report rides along and the model returns the reconciled whole. These tests
 * pin the CONTRACT of that hand-off: the prior report reaches the job, and whatever comes back is
 * stored as the complete record.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const runJobBySlug = vi.fn();
const getOccurrenceWithActivity = vi.fn();
const recordOccurrenceLog = vi.fn();
const insertGoalEvent = vi.fn();
const logAi = vi.fn();

vi.mock('../ai/aim.ts', () => ({ runJobBySlug: (...a: unknown[]) => runJobBySlug(...a) }));
vi.mock('../repos/occurrences.ts', () => ({
  getOccurrenceWithActivity: (...a: unknown[]) => getOccurrenceWithActivity(...a),
  recordOccurrenceLog: (...a: unknown[]) => recordOccurrenceLog(...a),
}));
vi.mock('../repos/goal-events.ts', () => ({ insertGoalEvent: (...a: unknown[]) => insertGoalEvent(...a) }));
vi.mock('./ai-log.ts', () => ({ logAi: (...a: unknown[]) => logAi(...a) }));

const { logOccurrence } = await import('./session-log.ts');

const USER = '00000000-0000-4000-a000-00000000b301';
const OCC = 'occ-1';

/** The first telling: 8k in 44 minutes, HR 152 — already stored. */
const ALREADY_LOGGED = {
  occurrence_id: OCC,
  activity_id: 'a1',
  title: 'Easy run',
  category: 'cardio',
  session: {},
  value: { distance_km: 8, duration_min: 44, avg_hr: 152 },
  log: { items: [], summary: '8k easy, felt good', raw_text: '8k in 44 minutes, HR averaged 152', logged_at: 'x' },
};

const reply = (o: Record<string, unknown>) => ({ formatted: JSON.stringify(o) });

describe('logOccurrence — revising a session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordOccurrenceLog.mockResolvedValue(true);
    logAi.mockResolvedValue(undefined);
  });

  it('hands the already-stored report to the parse, so it can reconcile rather than guess', async () => {
    getOccurrenceWithActivity.mockResolvedValue(ALREADY_LOGGED);
    runJobBySlug.mockResolvedValue(reply({ items: [], summary: 'x', metrics: { distance_km: 8 } }));

    await logOccurrence(USER, OCC, 'oh — and it was pouring the whole way');

    const [, slug, vars] = runJobBySlug.mock.calls[0]!;
    expect(slug).toBe('parse-session-log');
    const prior = JSON.parse((vars as { prior_log: string }).prior_log);
    expect(prior.metrics).toEqual({ distance_km: 8, duration_min: 44, avg_hr: 152 });
    expect(prior.summary).toBe('8k easy, felt good');
  });

  it('sends no prior report on a first log, so nothing is invented', async () => {
    getOccurrenceWithActivity.mockResolvedValue({ ...ALREADY_LOGGED, value: {}, log: null });
    runJobBySlug.mockResolvedValue(reply({ items: [], summary: 'x', metrics: { distance_km: 5 } }));

    await logOccurrence(USER, OCC, 'did 5k');
    expect((runJobBySlug.mock.calls[0]![2] as { prior_log: string }).prior_log).toBe('');
  });

  /** The incident: an ADDITION must not cost the numbers. */
  it('stores the reconciled whole when the revision only adds a detail', async () => {
    getOccurrenceWithActivity.mockResolvedValue(ALREADY_LOGGED);
    runJobBySlug.mockResolvedValue(
      reply({
        items: [],
        summary: '8k easy in the rain',
        metrics: { distance_km: 8, duration_min: 44, avg_hr: 152 },
      }),
    );

    await logOccurrence(USER, OCC, 'oh — and it was pouring the whole way');
    const [, , fields] = recordOccurrenceLog.mock.calls[0]!;
    expect(fields.value).toEqual({ distance_km: 8, duration_min: 44, avg_hr: 152 });
  });

  /** …and a REPLACEMENT must not keep a distance from a run they did not do. */
  it('lets a correction drop what it makes untrue', async () => {
    getOccurrenceWithActivity.mockResolvedValue(ALREADY_LOGGED);
    runJobBySlug.mockResolvedValue(reply({ items: [], summary: 'biked instead', metrics: { duration_min: 44 } }));

    await logOccurrence(USER, OCC, 'scratch that, I biked instead');
    const [, , fields] = recordOccurrenceLog.mock.calls[0]!;
    expect(fields.value).toEqual({ duration_min: 44 });
    expect(fields.value.distance_km).toBeUndefined();
  });

  /** Their own words are record, not interpretation, so both tellings survive a reconciliation. */
  it('keeps the earlier words alongside the new ones', async () => {
    getOccurrenceWithActivity.mockResolvedValue(ALREADY_LOGGED);
    runJobBySlug.mockResolvedValue(reply({ items: [], summary: 'x', metrics: {} }));

    await logOccurrence(USER, OCC, 'it was pouring');
    const [, , fields] = recordOccurrenceLog.mock.calls[0]!;
    expect(fields.log.raw_text).toContain('8k in 44 minutes');
    expect(fields.log.raw_text).toContain('it was pouring');
  });

  it('does not duplicate the words when the same text is logged twice', async () => {
    getOccurrenceWithActivity.mockResolvedValue(ALREADY_LOGGED);
    runJobBySlug.mockResolvedValue(reply({ items: [], summary: 'x', metrics: {} }));

    await logOccurrence(USER, OCC, ALREADY_LOGGED.log.raw_text);
    const [, , fields] = recordOccurrenceLog.mock.calls[0]!;
    expect(fields.log.raw_text).toBe(ALREADY_LOGGED.log.raw_text);
  });
});

/**
 * Sets of a timed effort (walkthrough v3 R1). The walkthrough's Finish writes a summary line like
 * "farmer carry 4×40 s @ 2×40 lb"; the parse hands back an item with `sets`, `duration_min` (one
 * set — see `OccurrenceLogItem`) and `load`. All three have to reach the stored log — a sets-of-time
 * item that lost its seconds would read as four sets of nothing.
 */
describe('logOccurrence — a timed effort done in sets keeps sets, the length of one set and the load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordOccurrenceLog.mockResolvedValue(true);
    logAi.mockResolvedValue(undefined);
    getOccurrenceWithActivity.mockResolvedValue({
      occurrence_id: OCC,
      activity_id: 'a1',
      title: 'Obstacle strength',
      category: 'strength',
      session: {},
      value: null,
      log: null,
    });
  });

  it('stores all three fields as the parse returned them', async () => {
    runJobBySlug.mockResolvedValue(
      reply({
        items: [{ name: 'Farmer carry', done: true, sets: 4, reps: null, load: '2×40 lb', duration_min: 0.67 }],
        summary: 'Four 40-second carries with the 40s.',
        metrics: {},
        events: [],
      }),
    );
    const out = await logOccurrence(USER, OCC, 'farmer carry 4×40 s @ 2×40 lb');
    expect(out?.log.items).toEqual([
      { name: 'Farmer carry', done: true, sets: 4, load: '2×40 lb', duration_min: 0.67 },
    ]);
    const stored = recordOccurrenceLog.mock.calls[0]![2] as { log: { items: unknown[] } };
    expect(stored.log.items).toEqual(out?.log.items);
  });
});
