/**
 * API-P2 — one race, one goal.
 *
 * Ambient capture re-runs on every conversational turn against the whole window, so the model
 * spends most of its output re-expressing its OWN earlier extraction in new words. A real device
 * run captured "Spartan Ultrabeast" and then, a few turns later, "Spartan Ultra Beast" — two pills
 * for one race — and separately watched every pill vanish on a turn about time of day.
 *
 * These drive `runCaptureExtract` turn by turn against an in-memory goals table, because the bug
 * only exists ACROSS runs: every unit of it looked fine on its own.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Goal } from '@cadence/shared';

const runJobBySlug = vi.fn();

/** Stand-in for cadence.goals — the merge rule is only meaningful against real accumulated rows. */
let rows: Goal[] = [];
let seq = 0;

const insertGoal = vi.fn(async (_u: string, g: Partial<Goal>) => {
  const row = { goal_id: `g${++seq}`, status: 'captured', milestones: [], ...g } as Goal;
  rows.push(row);
  return row;
});
const listGoalsByStatus = vi.fn(async (_u: string, statuses: string[]) =>
  rows.filter((r) => statuses.includes(r.status)),
);
// Mirrors the repo's coalesce semantics: an absent field keeps whatever the row already had.
const updateGoal = vi.fn(async (_u: string, id: string, patch: Partial<Goal>) => {
  const row = rows.find((r) => r.goal_id === id) as Record<string, unknown> | undefined;
  if (row) for (const [k, v] of Object.entries(patch)) if (v !== undefined) row[k] = v;
});
const deleteGoal = vi.fn(async (_u: string, id: string) => {
  rows = rows.filter((r) => r.goal_id !== id);
});

vi.mock('../ai/aim.ts', () => ({ runJobBySlug: (...a: unknown[]) => runJobBySlug(...a) }));
vi.mock('../config.ts', () => ({
  cadenceConfig: {
    databaseUrl: 'postgresql://mock:mock@mock:5432/mock',
    supabase: { url: '', anonKey: '', serviceRoleKey: '' },
    aim: {},
  },
}));
vi.mock('../repos/goals.ts', () => ({
  insertGoal: (u: string, g: Partial<Goal>) => insertGoal(u, g),
  listGoalsByStatus: (u: string, s: string[]) => listGoalsByStatus(u, s),
  updateGoal: (u: string, id: string, patch: Partial<Goal>) => updateGoal(u, id, patch),
  deleteGoal: (u: string, id: string) => deleteGoal(u, id),
}));
vi.mock('../repos/equipment.ts', () => ({ insertEquipment: async () => {}, deleteAllEquipment: async () => {} }));
vi.mock('../repos/users.ts', () => ({
  mergeBaseline: async () => {},
  setName: async () => {},
  setTimezoneIfUnset: async () => {},
  getUser: async () => ({ baseline: { weight_kg: 80 }, home_location: null, timezone: null }),
  setHomeLocation: async () => {},
}));
vi.mock('./ai-log.ts', () => ({ logAi: async () => {} }));

import { runCaptureExtract } from './capture.ts';

const USER = '00000000-0000-4000-a000-00000000a203';

/** One conversational turn's worth of Broker output. */
async function turn(goals: Partial<Goal>[], window = 'turn'): Promise<void> {
  runJobBySlug.mockResolvedValue({
    formatted: JSON.stringify({ goals, equipment: [], baseline_updates: {}, confidence: 'high' }),
  });
  await runCaptureExtract(USER, { conversation_window: window });
}

const captured = () => rows.filter((r) => r.status === 'captured');

describe('capture goal identity across turns (§6.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rows = [];
    seq = 0;
  });

  it('keeps ONE goal when the model rewords its own extraction across turns', async () => {
    await turn([
      {
        title: 'Spartan Ultrabeast',
        area: 'movement',
        type: 'milestone',
        brief: "It's 50 km in the mountains.",
      },
    ]);
    await turn([
      {
        title: 'Complete the Spartan Ultra Beast in Quebec',
        area: 'movement',
        type: 'milestone',
        brief: "It's 50 km in the mountains, 30+ obstacles, and I've run the course before as a Beast.",
      },
    ]);
    // A thinner third telling — the same race, said in passing, with nothing new attached.
    await turn([{ title: 'Spartan Ultra Beast', area: 'movement', type: 'milestone' }]);

    expect(captured()).toHaveLength(1);
    const goal = captured()[0]!;
    // The row — and its id — is the one the user has been looking at since turn one.
    expect(goal.goal_id).toBe('g1');
    // The fuller title wins; the richer brief is never traded down for a later, thinner one.
    expect(goal.title).toBe('Complete the Spartan Ultra Beast in Quebec');
    expect(goal.brief).toContain('30+ obstacles');
  });

  it('keeps two genuinely different goals in ONE area apart', async () => {
    await turn([
      { title: 'Lose weight', area: 'movement', type: 'target' },
      { title: 'Run a 50 km', area: 'movement', type: 'milestone' },
    ]);
    await turn([
      { title: 'Lose some weight', area: 'movement', type: 'target' },
      { title: 'Run a 50 km ultra', area: 'movement', type: 'milestone' },
    ]);

    // Each turn's rewording folded into its OWN goal — two rows in, two rows out, both retitled.
    expect(
      captured()
        .map((g) => g.title)
        .sort(),
    ).toEqual(['Lose some weight', 'Run a 50 km ultra']);
  });

  // The vanishing pills: the user answered a question about time of day, the extraction came back
  // with no goals, and the wholesale delete-then-reinsert took every card with it.
  it('leaves existing goals standing when a turn extracts no goals at all', async () => {
    await turn([{ title: 'Run a 10k', area: 'movement', type: 'milestone' }]);
    await turn([], 'I train in the mornings, usually before work');

    expect(captured().map((g) => g.title)).toEqual(['Run a 10k']);
  });

  // Self-healing for rows a previous build already duplicated — including the user's live account.
  it('folds pre-existing duplicate rows into one, keeping the richer brief and the stepping-stones', async () => {
    rows = [
      {
        goal_id: 'old1',
        title: 'Spartan Ultrabeast',
        area: 'movement',
        type: 'milestone',
        status: 'captured',
        milestones: [],
        measure: {},
        timeframe: {},
        linked_equipment: [],
        source: 'captured',
        brief: "It's 50 km in the mountains, 30+ obstacles.",
      } as unknown as Goal,
      {
        goal_id: 'old2',
        title: 'Spartan Ultra Beast',
        area: 'movement',
        type: 'milestone',
        status: 'captured',
        milestones: [{ id: 'm1', label: 'Build to a continuous 25 km' }],
        measure: {},
        timeframe: {},
        linked_equipment: [],
        source: 'captured',
      } as unknown as Goal,
    ];

    await turn([{ title: 'Spartan Ultra Beast', area: 'movement', type: 'milestone' }]);

    expect(captured()).toHaveLength(1);
    const goal = captured()[0]!;
    // The row carrying stepping-stones is the survivor — it is the one with work invested in it.
    expect(goal.goal_id).toBe('old2');
    expect(goal.milestones).toHaveLength(1);
    // ...and the brief that lived only on the row we folded away came with it.
    expect(goal.brief).toContain('30+ obstacles');
  });

  it('never re-captures a goal the user already confirmed, however it is respelled', async () => {
    rows = [
      {
        goal_id: 'c1',
        title: 'Spartan Ultrabeast',
        area: 'movement',
        type: 'milestone',
        status: 'confirmed',
        milestones: [],
        measure: {},
        timeframe: {},
        linked_equipment: [],
        source: 'captured',
      } as unknown as Goal,
    ];

    await turn([{ title: 'Spartan Ultra Beast!', area: 'movement', type: 'milestone' }]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('confirmed');
    expect(updateGoal).not.toHaveBeenCalled(); // a locked goal is never rewritten by capture
  });
});
