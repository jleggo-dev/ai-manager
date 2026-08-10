/**
 * API-P2 — capture orchestration: out-of-enum coercion never drops; near-duplicate goals → one row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const runJobBySlug = vi.fn();
const insertGoal = vi.fn();
const listGoalsByStatus = vi.fn();
const deleteCapturedWithoutMilestones = vi.fn();
const insertEquipment = vi.fn();
const deleteAllEquipment = vi.fn();
const mergeBaseline = vi.fn();
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
  deleteCapturedWithoutMilestones: (...a: unknown[]) => deleteCapturedWithoutMilestones(...a),
}));
vi.mock('../repos/equipment.ts', () => ({
  insertEquipment: (...a: unknown[]) => insertEquipment(...a),
  deleteAllEquipment: (...a: unknown[]) => deleteAllEquipment(...a),
}));
vi.mock('../repos/users.ts', () => ({
  mergeBaseline: (...a: unknown[]) => mergeBaseline(...a),
  setName: (...a: unknown[]) => setName(...a),
  setTimezoneIfUnset: (...a: unknown[]) => setTimezoneIfUnset(...a),
  // The goal screen reads baseline weight to price a loss rate; no home_location, so the
  // geocode branch stays off.
  getUser: async () => ({ baseline: { weight_kg: 80 }, home_location: null, timezone: null }),
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
    deleteCapturedWithoutMilestones.mockResolvedValue(undefined);
    insertGoal.mockResolvedValue({ goal_id: 'g1' });
    insertEquipment.mockResolvedValue({ equipment_id: 'e1' });
    deleteAllEquipment.mockResolvedValue(undefined);
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
    expect(deleteAllEquipment).toHaveBeenCalledWith(USER);
    expect(insertEquipment).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ name: 'Foam roller', category: 'other' }),
    );
    warn.mockRestore();
  });
});
