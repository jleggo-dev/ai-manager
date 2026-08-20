/**
 * API-P2 — capture orchestration: out-of-enum coercion never drops; near-duplicate goals → one row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const runJobBySlug = vi.fn();
const insertGoal = vi.fn();
const listGoalsByStatus = vi.fn();
const updateGoal = vi.fn();
const deleteGoal = vi.fn();
const insertEquipment = vi.fn();
const listEquipment = vi.fn();
const updateEquipment = vi.fn();
const mergeBaseline = vi.fn();
const getUser = vi.fn(
  async (_id: string) => ({ baseline: { weight_kg: 80 }, home_location: null, timezone: null }) as unknown,
);
const setName = vi.fn();
const setTimezoneIfUnset = vi.fn();
const logAi = vi.fn();

vi.mock('../ai/aim.ts', () => ({
  runJobBySlug: (...a: unknown[]) => runJobBySlug(...a),
}));
vi.mock('../config.ts', () => ({
  // Minimal: the services no longer read config, but their repos' import chain reaches
  // db/sql.ts, whose module scope builds the DB URL and throws without CADENCE_* env (CI).
  cadenceConfig: {
    databaseUrl: 'postgresql://mock:mock@mock:5432/mock',
    supabase: { url: '', anonKey: '', serviceRoleKey: '' },
    aim: {},
  },
}));
vi.mock('../repos/goals.ts', () => ({
  insertGoal: (...a: unknown[]) => insertGoal(...a),
  listGoalsByStatus: (...a: unknown[]) => listGoalsByStatus(...a),
  updateGoal: (...a: unknown[]) => updateGoal(...a),
  deleteGoal: (...a: unknown[]) => deleteGoal(...a),
}));
vi.mock('../repos/equipment.ts', () => ({
  insertEquipment: (...a: unknown[]) => insertEquipment(...a),
  listEquipment: (...a: unknown[]) => listEquipment(...a),
  updateEquipment: (...a: unknown[]) => updateEquipment(...a),
}));
vi.mock('../repos/users.ts', () => ({
  mergeBaseline: (...a: unknown[]) => mergeBaseline(...a),
  setName: (...a: unknown[]) => setName(...a),
  setTimezoneIfUnset: (...a: unknown[]) => setTimezoneIfUnset(...a),
  // The goal screen reads baseline weight to price a loss rate; no home_location, so the
  // geocode branch stays off. Mockable because the weight-start guard reads the STORED record.
  getUser: (id: string) => getUser(id),
  setHomeLocation: async () => {},
}));
vi.mock('./ai-log.ts', () => ({
  logAi: (...a: unknown[]) => logAi(...a),
}));

import { runCaptureExtract } from './capture.ts';

const USER = '00000000-0000-4000-a000-00000000a202';

describe('runCaptureExtract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listGoalsByStatus.mockResolvedValue([]);
    updateGoal.mockResolvedValue(undefined);
    deleteGoal.mockResolvedValue(undefined);
    insertGoal.mockResolvedValue({ goal_id: 'g1' });
    insertEquipment.mockResolvedValue({ equipment_id: 'e1' });
    listEquipment.mockResolvedValue([]);
    updateEquipment.mockResolvedValue(undefined);
    mergeBaseline.mockResolvedValue(undefined);
    setName.mockResolvedValue(undefined);
    setTimezoneIfUnset.mockResolvedValue(undefined);
    logAi.mockResolvedValue(undefined);
  });

  it('coerces legacy area labels and persists (never drops)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    runJobBySlug.mockResolvedValue({
      formatted: JSON.stringify({
        goals: [{ title: 'Run more', area: 'fitness', type: 'recurring' }],
        equipment: [],
        baseline_updates: {},
        confidence: 'high',
      }),
    });

    const out = await runCaptureExtract(USER, { conversation_window: 'I want to run more' });
    expect(out.persisted.goals).toBe(1);
    expect(insertGoal).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ title: 'Run more', area: 'movement', type: 'recurring' }),
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  // The goal survives; only the impossible number is dropped. Losing the goal too would be the
  // "start over" feeling the brand promises never to cause, over a mistake the model made.
  it('drops a measure whose arithmetic cannot be true, and keeps the goal', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    runJobBySlug.mockResolvedValue({
      formatted: JSON.stringify({
        goals: [
          {
            title: 'Lose weight',
            area: 'nourishment',
            type: 'target',
            measure: { metric: 'body weight', target: 195, start: 195, direction: 'decrease' },
          },
        ],
        equipment: [],
        baseline_updates: {},
        confidence: 'high',
      }),
    });

    const out = await runCaptureExtract(USER, { conversation_window: 'I want to lose weight' });
    expect(out.persisted.goals).toBe(1);
    expect(insertGoal).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ title: 'Lose weight', measure: undefined }),
    );
    expect(warn).toHaveBeenCalled(); // never silent — it lands in the coercion log
    warn.mockRestore();
  });

  it('dedupes near-duplicate goals from one capture run to a single insert', async () => {
    runJobBySlug.mockResolvedValue({
      formatted: JSON.stringify({
        goals: [
          { title: 'Read 12 books', area: 'mind', type: 'target' },
          { title: 'read 12 books!', area: 'mind', type: 'target' },
        ],
        equipment: [],
        baseline_updates: {},
        confidence: 'medium',
      }),
    });

    const out = await runCaptureExtract(USER, { conversation_window: 'books' });
    expect(out.persisted.goals).toBe(1);
    expect(insertGoal).toHaveBeenCalledTimes(1);
  });

  // The facts that decide how hard the work has to be ride WITH the goal, because the plan job
  // never sees the transcript they were said in.
  it('persists a goal brief alongside the goal', async () => {
    runJobBySlug.mockResolvedValue({
      formatted: JSON.stringify({
        goals: [
          {
            title: 'Complete the Spartan Ultra Beast in Quebec',
            brief: "It's 50 km  in the mountains,\n30+ obstacles.",
            area: 'movement',
            type: 'milestone',
          },
        ],
        equipment: [],
        baseline_updates: {},
        confidence: 'high',
      }),
    });

    await runCaptureExtract(USER, { conversation_window: 'ultra beast' });
    expect(insertGoal).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ brief: "It's 50 km in the mountains, 30+ obstacles." }),
    );
  });

  // "I live in Quebec, so that's Eastern" used to go nowhere: users.timezone stayed null while
  // date-context, the daily check-in and every notification schedule ran on a default.
  it('records a stated timezone, and only a real one', async () => {
    const withTz = (timezone: unknown) => ({
      formatted: JSON.stringify({ goals: [], equipment: [], baseline_updates: {}, timezone, confidence: 'high' }),
    });

    runJobBySlug.mockResolvedValue(withTz('America/Toronto'));
    await runCaptureExtract(USER, { conversation_window: 'eastern time' });
    expect(setTimezoneIfUnset).toHaveBeenCalledWith(USER, 'America/Toronto');

    setTimezoneIfUnset.mockClear();
    runJobBySlug.mockResolvedValue(withTz('EST'));
    await runCaptureExtract(USER, { conversation_window: 'eastern time' });
    expect(setTimezoneIfUnset).not.toHaveBeenCalled();
  });

  it('coerces unknown equipment categories to other', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    runJobBySlug.mockResolvedValue({
      formatted: JSON.stringify({
        goals: [],
        equipment: [{ name: 'Foam roller', category: 'weird-thing' }],
        baseline_updates: {},
        confidence: 'low',
      }),
    });

    const out = await runCaptureExtract(USER, { conversation_window: 'I have a foam roller' });
    expect(out.persisted.equipment).toBe(1);
    expect(listEquipment).toHaveBeenCalledWith(USER);
    expect(insertEquipment).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ name: 'Foam roller', category: 'other' }),
    );
    warn.mockRestore();
  });
});

/**
 * The bug that ate nineteen items down to one.
 *
 * Capture used to REPLACE the equipment set whenever it returned anything, guarded only against an
 * empty extraction. One item was enough: on 2026-08-17 a conversation about dead hangs mentioned a
 * pull-up bar, and the delete took the treadmill, the rowing machine, both bikes, the kettlebells
 * and the TRX with it. Owner: *"I had a ton of equipment listed in Cadence, but it looks like it
 * disappeared somehow."*
 *
 * Identical in shape to the constraints bug fixed in the same function weeks earlier — capture runs
 * over the whole conversation every turn, so anything it "replaces" is replaced by whatever today
 * happened to mention. Rule 1 of constraint-merge.ts, word for word: nothing is dropped by silence.
 */
describe('equipment survives a conversation that only mentions one thing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // This block sits outside `runCaptureExtract`'s describe, so it owns its own setup.
    listGoalsByStatus.mockResolvedValue([]);
    insertGoal.mockResolvedValue({ goal_id: 'g1' });
    insertEquipment.mockResolvedValue({ equipment_id: 'eNew' });
    updateEquipment.mockResolvedValue(undefined);
    mergeBaseline.mockResolvedValue(undefined);
    setName.mockResolvedValue(undefined);
    setTimezoneIfUnset.mockResolvedValue(undefined);
    logAi.mockResolvedValue(undefined);
    listEquipment.mockResolvedValue([
      { equipment_id: 'e1', name: 'treadmill with incline', category: 'cardio' },
      { equipment_id: 'e2', name: 'rowing machine', category: 'cardio' },
      { equipment_id: 'e3', name: 'pull-up bar', category: 'strength' },
    ]);
  });

  it('never deletes what today did not happen to mention', async () => {
    runJobBySlug.mockResolvedValue({
      formatted: JSON.stringify({ goals: [], equipment: [{ name: 'pull-up bar', category: 'strength' }] }),
    });
    await runCaptureExtract(USER, { conversation_window: 'we did dead hangs on the pull-up bar' });
    // The rowing machine is still in the garage.
    expect(insertEquipment).not.toHaveBeenCalled();
    expect(updateEquipment).toHaveBeenCalledTimes(1);
    expect(updateEquipment.mock.calls[0]![1]).toBe('e3');
  });

  it('adds something genuinely new without disturbing the rest', async () => {
    runJobBySlug.mockResolvedValue({
      formatted: JSON.stringify({ goals: [], equipment: [{ name: 'ski erg', category: 'cardio' }] }),
    });
    await runCaptureExtract(USER, { conversation_window: 'I picked up a ski erg' });
    expect(insertEquipment).toHaveBeenCalledTimes(1);
    expect(updateEquipment).not.toHaveBeenCalled();
  });

  /** The same item restated must update in place, not arrive as a twin — the goal-duplication
   *  failure, which once tripled someone's goals, applies here too. */
  it('matches case-insensitively so a restated item does not become a duplicate', async () => {
    runJobBySlug.mockResolvedValue({
      formatted: JSON.stringify({ goals: [], equipment: [{ name: 'Rowing Machine', category: 'cardio' }] }),
    });
    await runCaptureExtract(USER, { conversation_window: 'the Rowing Machine is by the window' });
    expect(insertEquipment).not.toHaveBeenCalled();
    expect(updateEquipment.mock.calls[0]![1]).toBe('e2');
  });
});

/**
 * A weight mentioned in chat moves where you ARE, never where you STARTED.
 *
 * capture-extract runs on EVERY coach turn and writes a whole `weight_kg` record; `mergeBaseline`
 * is a shallow jsonb merge, so that record replaces the stored one outright. Before the guard,
 * saying "I'm 85 now" three months in overwrote the 88.5 you began at — every progress read
 * silently rebased to zero, and the adaptive targets lost the series they reason from. `weigh-in.ts`
 * has always merged this correctly for the weekly check-in; the chat path had not.
 */
describe('a weight said in chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listGoalsByStatus.mockResolvedValue([]);
    insertGoal.mockResolvedValue({ goal_id: 'g1' });
    listEquipment.mockResolvedValue([]);
    mergeBaseline.mockResolvedValue(undefined);
    setName.mockResolvedValue(undefined);
    setTimezoneIfUnset.mockResolvedValue(undefined);
    logAi.mockResolvedValue(undefined);
    runJobBySlug.mockResolvedValue({
      formatted: JSON.stringify({
        goals: [],
        equipment: [],
        baseline_updates: { weight: { value: 85, unit: 'kg' } },
        confidence: 'high',
      }),
    });
  });

  it('updates current and KEEPS the original starting weight', async () => {
    getUser.mockResolvedValue({
      baseline: { weight_kg: { current: 88.54, start: 88.54, source: 'captured' } },
      home_location: null,
      timezone: null,
    } as unknown);

    await runCaptureExtract(USER, { conversation_window: "I'm 85 now" });

    const patch = mergeBaseline.mock.calls[0]?.[1] as { weight_kg?: { current: number; start: number } };
    expect(patch.weight_kg?.current).toBe(85);
    expect(patch.weight_kg?.start).toBe(88.54); // the beginning survives
  });

  it('takes the spoken weight as the start when there is no history yet — onboarding', async () => {
    getUser.mockResolvedValue({ baseline: {}, home_location: null, timezone: null } as unknown);

    await runCaptureExtract(USER, { conversation_window: "I'm 85kg" });

    const patch = mergeBaseline.mock.calls[0]?.[1] as { weight_kg?: { current: number; start: number } };
    expect(patch.weight_kg?.current).toBe(85);
    expect(patch.weight_kg?.start).toBe(85); // first time IS the beginning
  });
});
