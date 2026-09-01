/**
 * GET /plan/routines' data layer (Activity Builder A3 — "the coach's sessions as the template
 * library"): a `commitment_id` LINEAGE survives across plan versions the way `activity_id` never
 * does, so the cases worth pinning are the ones where getting the grouping wrong would either
 * duplicate a routine (one per plan version instead of one per lineage) or silently drop the ones
 * the user isn't doing this week. Everything is mocked, so this never reaches db/sql.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ActivityVersionRow, LineageFinishRow, LineageSessionRow } from '../repos/routines.ts';

const listUserActivityVersions = vi.fn();
const listLineageFinishCounts = vi.fn();
const listLineageLatestSessions = vi.fn();
const getLatestSessionForCommitment = vi.fn();
const listGoals = vi.fn();

vi.mock('../repos/routines.ts', () => ({
  listUserActivityVersions: (...a: unknown[]) => listUserActivityVersions(...a),
  listLineageFinishCounts: (...a: unknown[]) => listLineageFinishCounts(...a),
  listLineageLatestSessions: (...a: unknown[]) => listLineageLatestSessions(...a),
  getLatestSessionForCommitment: (...a: unknown[]) => getLatestSessionForCommitment(...a),
}));
vi.mock('../repos/goals.ts', () => ({ listGoals: (...a: unknown[]) => listGoals(...a) }));
// The real Set, not a stand-in — a wrong drift here (e.g. missing 'episode') would silently let a
// temp detour option slip into someone's routine library, so this borrows the actual values
// rather than re-typing them.
vi.mock('../repos/activities.ts', () => ({ NON_PLAN_CATEGORIES: new Set(['adhoc', 'episode', 'menu']) }));

import { listRoutines, latestVersionByCommitment, parseAreaParam, getRoutineSession } from './routines.ts';

const USER = '00000000-0000-4000-a000-00000000c101';

function actRow(over: Partial<ActivityVersionRow> = {}): ActivityVersionRow {
  return {
    commitment_id: 'c1',
    activity_id: 'act-1',
    title: 'Easy 5k',
    goal_id: 'g1',
    schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=TU,TH', duration_min: 30 },
    category: null,
    plan_id: 'plan-active',
    plan_version: 3,
    plan_status: 'active',
    kind: 'user',
    ...over,
  };
}

function session(itemNames: string[]): {
  blocks: { label: string; items: { name: string }[] }[];
  note: string;
  generated_at: string;
  version: number;
} {
  return {
    blocks: [{ label: 'Main', items: itemNames.map((name) => ({ name })) }],
    note: '',
    generated_at: '2026-08-01T00:00:00Z',
    version: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listUserActivityVersions.mockResolvedValue([]);
  listLineageFinishCounts.mockResolvedValue([]);
  listLineageLatestSessions.mockResolvedValue([]);
  getLatestSessionForCommitment.mockResolvedValue(null);
  listGoals.mockResolvedValue([
    { goal_id: 'g1', area: 'movement' },
    { goal_id: 'g2', area: 'practice' },
  ]);
});

describe('latestVersionByCommitment', () => {
  it('picks the highest plan_version per commitment, regardless of input order', () => {
    const rows: ActivityVersionRow[] = [
      actRow({ commitment_id: 'c1', title: 'Easy 5k v1', plan_version: 1 }),
      actRow({ commitment_id: 'c1', title: 'Easy 5k v3', plan_version: 3 }),
      actRow({ commitment_id: 'c1', title: 'Easy 5k v2', plan_version: 2 }),
    ];
    const out = latestVersionByCommitment(rows);
    expect(out.get('c1')?.title).toBe('Easy 5k v3');
  });
});

describe('parseAreaParam', () => {
  it('accepts a valid area', () => expect(parseAreaParam('mind')).toBe('mind'));
  it('treats an unrecognized value as no filter', () => expect(parseAreaParam('cardio')).toBeUndefined());
  it('treats an absent/undefined value as no filter', () => expect(parseAreaParam(undefined)).toBeUndefined());
});

describe('listRoutines', () => {
  it('groups activity rows across plan versions by commitment_id — one routine per lineage, using the newest version', async () => {
    listUserActivityVersions.mockResolvedValue([
      actRow({ commitment_id: 'c1', title: 'Easy 5k — old name', plan_version: 1, plan_status: 'superseded' }),
      actRow({ commitment_id: 'c1', title: 'Easy 5k', plan_version: 2, plan_status: 'active' }),
    ]);
    const routines = await listRoutines(USER);
    expect(routines).toHaveLength(1);
    expect(routines[0]?.title).toBe('Easy 5k');
  });

  it('ranks by finishes desc, then last_done desc', async () => {
    listUserActivityVersions.mockResolvedValue([
      actRow({ commitment_id: 'c1', title: 'Fewer finishes, newer' }),
      actRow({ commitment_id: 'c2', title: 'Most finishes' }),
      actRow({ commitment_id: 'c3', title: 'Tied finishes, older' }),
      actRow({ commitment_id: 'c4', title: 'Tied finishes, newer' }),
    ]);
    listLineageFinishCounts.mockResolvedValue([
      { commitment_id: 'c1', finishes: 2, last_done: '2026-08-30' },
      { commitment_id: 'c2', finishes: 11, last_done: '2026-08-01' },
      { commitment_id: 'c3', finishes: 5, last_done: '2026-07-01' },
      { commitment_id: 'c4', finishes: 5, last_done: '2026-08-15' },
    ] satisfies LineageFinishRow[]);
    const routines = await listRoutines(USER);
    expect(routines.map((r) => r.commitment_id)).toEqual(['c2', 'c4', 'c3', 'c1']);
  });

  it('reports an honest empty steps array when no session has ever been cached for the lineage', async () => {
    listUserActivityVersions.mockResolvedValue([actRow({ commitment_id: 'c1' })]);
    listLineageLatestSessions.mockResolvedValue([]);
    const routines = await listRoutines(USER);
    expect(routines[0]?.steps).toEqual([]);
  });

  it('reads steps from the most recent cached session, flattened to item names', async () => {
    listUserActivityVersions.mockResolvedValue([actRow({ commitment_id: 'c1' })]);
    listLineageLatestSessions.mockResolvedValue([
      { commitment_id: 'c1', session: session(['Warm-up', 'Main set', 'Cool-down']) },
    ] satisfies LineageSessionRow[]);
    const routines = await listRoutines(USER);
    expect(routines[0]?.steps).toEqual(['Warm-up', 'Main set', 'Cool-down']);
  });

  it('filters to the requested area, using the linked goal — not the title', async () => {
    listUserActivityVersions.mockResolvedValue([
      actRow({ commitment_id: 'c1', title: 'Easy 5k', goal_id: 'g1' }), // movement
      actRow({ commitment_id: 'c2', title: 'Scales — C, G, D', goal_id: 'g2' }), // practice
    ]);
    const movement = await listRoutines(USER, 'movement');
    expect(movement.map((r) => r.commitment_id)).toEqual(['c1']);
    const practice = await listRoutines(USER, 'practice');
    expect(practice.map((r) => r.commitment_id)).toEqual(['c2']);
  });

  it('includes a lineage that is NOT on the active plan, marked on_plan: false with no current schedule', async () => {
    listUserActivityVersions.mockResolvedValue([
      actRow({
        commitment_id: 'c1',
        title: 'Hotel HIIT',
        plan_id: 'plan-old',
        plan_version: 1,
        plan_status: 'superseded',
      }),
    ]);
    listLineageFinishCounts.mockResolvedValue([{ commitment_id: 'c1', finishes: 4, last_done: '2026-08-10' }]);
    const routines = await listRoutines(USER);
    expect(routines).toHaveLength(1);
    expect(routines[0]?.on_plan).toBe(false);
    expect(routines[0]?.finishes).toBe(4);
    expect(routines[0]?.cadence).toBeUndefined();
    expect(routines[0]?.duration_min).toBeUndefined();
  });

  it('excludes off-plan bucket categories (adhoc/episode/menu) even when kind is user', async () => {
    listUserActivityVersions.mockResolvedValue([
      actRow({ commitment_id: 'c1', title: 'Off-plan workout', category: 'adhoc' }),
      actRow({ commitment_id: 'c2', title: 'Do what you can', category: 'episode' }),
      actRow({ commitment_id: 'c3', title: 'Real routine', category: null }),
    ]);
    const routines = await listRoutines(USER);
    expect(routines.map((r) => r.commitment_id)).toEqual(['c3']);
  });

  it('defaults finishes to 0 and last_done to null for a lineage never finished', async () => {
    listUserActivityVersions.mockResolvedValue([actRow({ commitment_id: 'c1' })]);
    listLineageFinishCounts.mockResolvedValue([]);
    const routines = await listRoutines(USER);
    expect(routines[0]?.finishes).toBe(0);
    expect(routines[0]?.last_done).toBeNull();
  });

  it('omits area when the commitment carries no goal link', async () => {
    listUserActivityVersions.mockResolvedValue([actRow({ commitment_id: 'c1', goal_id: null })]);
    const routines = await listRoutines(USER);
    expect(routines[0]?.area).toBeUndefined();
  });

  it("carries the LATEST version's activity_id — not an older version's — the id logDid credits", async () => {
    listUserActivityVersions.mockResolvedValue([
      actRow({ commitment_id: 'c1', activity_id: 'act-old', plan_version: 1, plan_status: 'superseded' }),
      actRow({ commitment_id: 'c1', activity_id: 'act-new', plan_version: 2, plan_status: 'active' }),
    ]);
    const routines = await listRoutines(USER);
    expect(routines[0]?.activity_id).toBe('act-new');
  });

  /**
   * 2026-09-01 fix: `kind` (like `category`) can change between plan versions — real dev data has
   * commitment "Log breakfast" as `user` in a superseded v1 and `system` in the active v2. The
   * lineage's CURRENT identity must decide, never an older version's — in EITHER direction.
   */
  describe('a lineage whose kind changes between plan versions', () => {
    it('is NOT emitted when the LATEST version is system-kind, even though an older version was user-kind', async () => {
      listUserActivityVersions.mockResolvedValue([
        actRow({
          commitment_id: 'c1',
          title: 'Log breakfast',
          plan_version: 1,
          plan_status: 'superseded',
          kind: 'user',
        }),
        actRow({ commitment_id: 'c1', title: 'Log breakfast', plan_version: 2, plan_status: 'active', kind: 'system' }),
      ]);
      listLineageFinishCounts.mockResolvedValue([{ commitment_id: 'c1', finishes: 40, last_done: '2026-08-31' }]);
      const routines = await listRoutines(USER);
      // A high finish count must not smuggle a capture task into the ranking — it simply isn't a
      // routine, however many times it accrued as one under an earlier version's kind.
      expect(routines).toEqual([]);
    });

    it('IS emitted with on_plan: true, its current schedule, and v1-era finishes counted, when the LATEST version is user-kind', async () => {
      listUserActivityVersions.mockResolvedValue([
        actRow({
          commitment_id: 'c1',
          title: 'Piano practice',
          plan_version: 1,
          plan_status: 'superseded',
          kind: 'system',
        }),
        actRow({
          commitment_id: 'c1',
          title: 'Piano practice',
          plan_version: 2,
          plan_status: 'active',
          kind: 'user',
          schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=TU,TH', duration_min: 25 },
        }),
      ]);
      // Finishes accrued while an EARLIER version was system-kind still belong to the lineage.
      listLineageFinishCounts.mockResolvedValue([{ commitment_id: 'c1', finishes: 3, last_done: '2026-08-20' }]);
      const routines = await listRoutines(USER);
      expect(routines).toHaveLength(1);
      expect(routines[0]?.on_plan).toBe(true);
      expect(routines[0]?.cadence).toBeTruthy();
      expect(routines[0]?.duration_min).toBe(25);
      expect(routines[0]?.finishes).toBe(3);
    });
  });
});

describe('getRoutineSession', () => {
  it("returns the repo's session for a lineage that has one", async () => {
    const s = session(['Warm-up', 'Main set']);
    getLatestSessionForCommitment.mockResolvedValue(s);
    const result = await getRoutineSession(USER, 'c1');
    expect(result).toBe(s);
    expect(getLatestSessionForCommitment).toHaveBeenCalledWith(USER, 'c1');
  });

  it('returns null for a lineage that has never had a session cached', async () => {
    getLatestSessionForCommitment.mockResolvedValue(null);
    expect(await getRoutineSession(USER, 'c1')).toBeNull();
  });

  it("returns null for a commitment id that isn't this user's — same value as 'never cached', by design", async () => {
    // The repo query scopes by user_id, so a foreign commitment_id comes back exactly like an
    // unwritten one: null. There is nothing here to distinguish the two, on purpose (no leak).
    getLatestSessionForCommitment.mockResolvedValue(null);
    expect(await getRoutineSession(USER, 'someone-elses-commitment')).toBeNull();
  });
});
