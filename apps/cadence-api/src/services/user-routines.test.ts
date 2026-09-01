/**
 * The user-routines store (Activity Builder wave 3) — "the coach's toolbox, handed to you." The
 * companion-activity model is the load-bearing decision this file pins: a routine that's never
 * been run or scheduled has no activity row at all, one that HAS gets a lazily-minted companion,
 * and a companion left behind on a superseded plan gets re-minted on the next run/schedule rather
 * than silently going stale. Getting any of those three wrong either orphans run history or makes
 * a routine invisible to the plan it's supposedly on. Everything is mocked, so this never reaches
 * db/sql.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Activity, OccurrenceSession } from '@cadence/shared';
import type { UserRoutineRow } from '../repos/user-routines.ts';
import type { LineageFinishRow } from '../repos/routines.ts';

const getActivePlan = vi.fn();
const getUserActivity = vi.fn();
const getOrInsertOccurrenceId = vi.fn();
const setOccurrenceStatus = vi.fn();
const setOccurrenceSession = vi.fn();
const listLineageFinishCounts = vi.fn();
const insertUserRoutine = vi.fn();
const listUserRoutinesRepo = vi.fn();
const getUserRoutineRow = vi.fn();
const updateUserRoutineRow = vi.fn();
const deleteUserRoutineRow = vi.fn();
const listActivitiesByIds = vi.fn();
const mintCompanionActivity = vi.fn();
const updateCompanionActivity = vi.fn();
const deleteFutureCompanionOccurrences = vi.fn();
const normalizeSession = vi.fn();
const ensureHorizon = vi.fn();

vi.mock('../repos/plans.ts', () => ({ getActivePlan: (...a: unknown[]) => getActivePlan(...a) }));
vi.mock('../repos/activities.ts', () => ({ getUserActivity: (...a: unknown[]) => getUserActivity(...a) }));
vi.mock('../repos/occurrences.ts', () => ({
  getOrInsertOccurrenceId: (...a: unknown[]) => getOrInsertOccurrenceId(...a),
  setOccurrenceStatus: (...a: unknown[]) => setOccurrenceStatus(...a),
}));
vi.mock('../repos/occurrence-sessions.ts', () => ({
  setOccurrenceSession: (...a: unknown[]) => setOccurrenceSession(...a),
}));
vi.mock('../repos/routines.ts', () => ({
  listLineageFinishCounts: (...a: unknown[]) => listLineageFinishCounts(...a),
}));
vi.mock('../repos/user-routines.ts', () => ({
  insertUserRoutine: (...a: unknown[]) => insertUserRoutine(...a),
  listUserRoutinesRepo: (...a: unknown[]) => listUserRoutinesRepo(...a),
  getUserRoutineRow: (...a: unknown[]) => getUserRoutineRow(...a),
  updateUserRoutineRow: (...a: unknown[]) => updateUserRoutineRow(...a),
  deleteUserRoutineRow: (...a: unknown[]) => deleteUserRoutineRow(...a),
  listActivitiesByIds: (...a: unknown[]) => listActivitiesByIds(...a),
  mintCompanionActivity: (...a: unknown[]) => mintCompanionActivity(...a),
  updateCompanionActivity: (...a: unknown[]) => updateCompanionActivity(...a),
  deleteFutureCompanionOccurrences: (...a: unknown[]) => deleteFutureCompanionOccurrences(...a),
}));
vi.mock('./session-normalize.ts', () => ({ normalizeSession: (...a: unknown[]) => normalizeSession(...a) }));
// scheduling.ts is left UNMOCKED on purpose — the real toRRule/parseRecurrence encoding is what
// "schedule encodes days+time correctly" has to prove, not a stand-in.
vi.mock('./plan-horizon.ts', () => ({
  ensureHorizon: (...a: unknown[]) => ensureHorizon(...a),
  DEFAULT_HORIZON_DAYS: 7,
}));

import {
  listUserRoutines,
  createUserRoutine,
  updateUserRoutine,
  deleteUserRoutine,
  runUserRoutine,
  scheduleUserRoutine,
  unscheduleUserRoutine,
  type UserRoutineScheduleInput,
} from './user-routines.ts';

const USER = '00000000-0000-4000-a000-00000000d101';
const ROUTINE_ID = 'r1';

const SESSION: OccurrenceSession = {
  blocks: [{ label: 'Main', items: [{ name: 'Scales' }] }],
  note: '',
  generated_at: '2026-08-01T00:00:00Z',
  version: 1,
};

function routineRow(over: Partial<UserRoutineRow> = {}): UserRoutineRow {
  return {
    routine_id: ROUTINE_ID,
    user_id: USER,
    name: 'Piano practice',
    area: 'practice',
    session: SESSION,
    provenance: { kind: 'blank' },
    activity_id: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...over,
  };
}

function activity(over: Partial<Activity> = {}): Activity {
  return {
    activity_id: 'act-1',
    commitment_id: 'commit-1',
    plan_id: 'plan-active',
    title: 'Piano practice',
    kind: 'user',
    category: 'user_built',
    schedule: { recurrence: '' },
    completion_source: 'self_report',
    ...over,
  };
}

const ACTIVE_PLAN = { plan_id: 'plan-active', version: 2, status: 'active' as const, horizon_days: 7 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-01T12:00:00.000Z'));
  getActivePlan.mockResolvedValue(ACTIVE_PLAN);
  listLineageFinishCounts.mockResolvedValue([]);
  listActivitiesByIds.mockResolvedValue([]);
  getOrInsertOccurrenceId.mockResolvedValue('occ-1');
});
afterEach(() => vi.useRealTimers());

describe('listUserRoutines', () => {
  it('lists a never-minted routine with zero runs, no last_run, no schedule', async () => {
    listUserRoutinesRepo.mockResolvedValue([routineRow({ activity_id: null })]);
    const routines = await listUserRoutines(USER);
    expect(routines).toEqual([
      expect.objectContaining({ routine_id: ROUTINE_ID, runs: 0, last_run: null, schedule: null }),
    ]);
  });

  it('decodes an on-plan companion schedule from its RRULE + time_of_day', async () => {
    listUserRoutinesRepo.mockResolvedValue([routineRow({ activity_id: 'act-1' })]);
    listActivitiesByIds.mockResolvedValue([
      activity({
        activity_id: 'act-1',
        schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', time_of_day: 'evening' },
      }),
    ]);
    listLineageFinishCounts.mockResolvedValue([
      { commitment_id: 'commit-1', finishes: 5, last_done: '2026-08-30' },
    ] satisfies LineageFinishRow[]);
    const [routine] = await listUserRoutines(USER);
    expect(routine?.runs).toBe(5);
    expect(routine?.last_run).toBe('2026-08-30');
    expect(routine?.schedule).toEqual({ days: ['mon', 'wed', 'fri'], time_of_day: 'evening' });
  });

  it('reads schedule: null for a companion left behind on a SUPERSEDED plan, even though it still has finishes', async () => {
    listUserRoutinesRepo.mockResolvedValue([routineRow({ activity_id: 'act-old' })]);
    listActivitiesByIds.mockResolvedValue([
      activity({
        activity_id: 'act-old',
        plan_id: 'plan-superseded',
        schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=MO' },
      }),
    ]);
    listLineageFinishCounts.mockResolvedValue([{ commitment_id: 'commit-1', finishes: 3, last_done: '2026-08-10' }]);
    const [routine] = await listUserRoutines(USER);
    expect(routine?.schedule).toBeNull();
    expect(routine?.runs).toBe(3); // history survives regardless of which plan the companion sits on
  });
});

describe('createUserRoutine', () => {
  it('returns null (route -> 400) when the session normalizes to nothing usable', async () => {
    normalizeSession.mockReturnValue(null);
    const result = await createUserRoutine(USER, { name: 'Blank', session: {}, provenance: { kind: 'blank' } });
    expect(result).toBeNull();
    expect(insertUserRoutine).not.toHaveBeenCalled();
  });

  it('inserts the normalized session and returns a fresh view (no companion yet)', async () => {
    normalizeSession.mockReturnValue(SESSION);
    insertUserRoutine.mockResolvedValue(routineRow({ activity_id: null }));
    const result = await createUserRoutine(USER, {
      name: 'Piano practice',
      area: 'practice',
      session: { blocks: [{ label: 'Main', items: [{ name: 'Scales' }] }] },
      provenance: { kind: 'blank' },
    });
    expect(insertUserRoutine).toHaveBeenCalledWith(USER, {
      name: 'Piano practice',
      area: 'practice',
      session: SESSION,
      provenance: { kind: 'blank' },
    });
    expect(result).toMatchObject({ runs: 0, last_run: null, schedule: null });
  });
});

describe('updateUserRoutine', () => {
  it('returns 404 for a routine that is not this user’s — no leak between "not found" and any other failure', async () => {
    getUserRoutineRow.mockResolvedValue(null);
    const result = await updateUserRoutine(USER, 'not-mine', { name: 'New name' });
    expect(result).toEqual({ ok: false, status: 404 });
    expect(normalizeSession).not.toHaveBeenCalled();
    expect(updateUserRoutineRow).not.toHaveBeenCalled();
  });

  it('returns 400 for a session that fails to normalize', async () => {
    getUserRoutineRow.mockResolvedValue(routineRow());
    normalizeSession.mockReturnValue(null);
    const result = await updateUserRoutine(USER, ROUTINE_ID, { session: {} });
    expect(result).toEqual({ ok: false, status: 400 });
    expect(updateUserRoutineRow).not.toHaveBeenCalled();
  });

  it('retitles the companion activity when name changes and a companion already exists', async () => {
    getUserRoutineRow.mockResolvedValue(routineRow({ activity_id: 'act-1' }));
    updateUserRoutineRow.mockResolvedValue(routineRow({ activity_id: 'act-1', name: 'New name' }));
    getUserActivity.mockResolvedValue(activity({ activity_id: 'act-1' }));
    const result = await updateUserRoutine(USER, ROUTINE_ID, { name: 'New name' });
    expect(result.ok).toBe(true);
    expect(updateCompanionActivity).toHaveBeenCalledWith(USER, 'act-1', { title: 'New name' });
  });

  it('does NOT touch the companion activity for a session-only edit', async () => {
    getUserRoutineRow.mockResolvedValue(routineRow({ activity_id: 'act-1' }));
    normalizeSession.mockReturnValue(SESSION);
    updateUserRoutineRow.mockResolvedValue(routineRow({ activity_id: 'act-1' }));
    getUserActivity.mockResolvedValue(activity({ activity_id: 'act-1' }));
    await updateUserRoutine(USER, ROUTINE_ID, { session: {} });
    expect(updateCompanionActivity).not.toHaveBeenCalled();
  });
});

describe('deleteUserRoutine', () => {
  it('returns false for a routine that is not this user’s', async () => {
    getUserRoutineRow.mockResolvedValue(null);
    expect(await deleteUserRoutine(USER, 'not-mine')).toBe(false);
    expect(deleteUserRoutineRow).not.toHaveBeenCalled();
  });

  it("reverts the companion recurrence to '' before deleting, when a companion exists", async () => {
    getUserRoutineRow.mockResolvedValue(routineRow({ activity_id: 'act-1' }));
    deleteUserRoutineRow.mockResolvedValue(true);
    expect(await deleteUserRoutine(USER, ROUTINE_ID)).toBe(true);
    expect(updateCompanionActivity).toHaveBeenCalledWith(USER, 'act-1', { schedule: { recurrence: '' } });
    expect(deleteUserRoutineRow).toHaveBeenCalledWith(USER, ROUTINE_ID);
  });

  it('skips the companion revert entirely for a routine that was never run or scheduled', async () => {
    getUserRoutineRow.mockResolvedValue(routineRow({ activity_id: null }));
    deleteUserRoutineRow.mockResolvedValue(true);
    await deleteUserRoutine(USER, ROUTINE_ID);
    expect(updateCompanionActivity).not.toHaveBeenCalled();
  });
});

describe('runUserRoutine', () => {
  it('returns 404 for a routine that is not this user’s', async () => {
    getUserRoutineRow.mockResolvedValue(null);
    expect(await runUserRoutine(USER, 'not-mine')).toEqual({ ok: false, status: 404 });
  });

  it('returns 409 when there is no active plan to attach the companion to', async () => {
    getUserRoutineRow.mockResolvedValue(routineRow());
    getActivePlan.mockResolvedValue(null);
    expect(await runUserRoutine(USER, ROUTINE_ID)).toEqual({ ok: false, status: 409 });
  });

  it('mints a companion on the FIRST run (no activity_id, no prior activity lookup)', async () => {
    getUserRoutineRow.mockResolvedValue(routineRow({ activity_id: null, name: 'Piano practice' }));
    mintCompanionActivity.mockResolvedValue(activity({ activity_id: 'act-new' }));
    const result = await runUserRoutine(USER, ROUTINE_ID);
    expect(result).toEqual({ ok: true });
    expect(getUserActivity).not.toHaveBeenCalled();
    expect(mintCompanionActivity).toHaveBeenCalledWith(USER, 'plan-active', ROUTINE_ID, 'Piano practice', undefined);
    expect(getOrInsertOccurrenceId).toHaveBeenCalledWith('act-new', USER, '2026-09-01');
  });

  it('reuses an already-fresh companion (still on the active plan) without minting again', async () => {
    getUserRoutineRow.mockResolvedValue(routineRow({ activity_id: 'act-1' }));
    getUserActivity.mockResolvedValue(activity({ activity_id: 'act-1', plan_id: 'plan-active' }));
    await runUserRoutine(USER, ROUTINE_ID);
    expect(mintCompanionActivity).not.toHaveBeenCalled();
    expect(getOrInsertOccurrenceId).toHaveBeenCalledWith('act-1', USER, '2026-09-01');
  });

  it('RE-mints, preserving the commitment_id, when the stored companion sits on a superseded plan', async () => {
    getUserRoutineRow.mockResolvedValue(routineRow({ activity_id: 'act-old' }));
    getUserActivity.mockResolvedValue(
      activity({ activity_id: 'act-old', plan_id: 'plan-superseded', commitment_id: 'commit-lineage' }),
    );
    mintCompanionActivity.mockResolvedValue(
      activity({ activity_id: 'act-new-version', commitment_id: 'commit-lineage' }),
    );
    await runUserRoutine(USER, ROUTINE_ID);
    expect(mintCompanionActivity).toHaveBeenCalledWith(
      USER,
      'plan-active',
      ROUTINE_ID,
      'Piano practice',
      'commit-lineage',
    );
    expect(getOrInsertOccurrenceId).toHaveBeenCalledWith('act-new-version', USER, '2026-09-01');
  });

  it("writes the routine's CURRENT session onto the occurrence and marks it done", async () => {
    const currentSession: OccurrenceSession = { ...SESSION, note: 'edited since last run' };
    getUserRoutineRow.mockResolvedValue(routineRow({ activity_id: 'act-1', session: currentSession }));
    getUserActivity.mockResolvedValue(activity({ activity_id: 'act-1', plan_id: 'plan-active' }));
    getOrInsertOccurrenceId.mockResolvedValue('occ-today');
    await runUserRoutine(USER, ROUTINE_ID);
    expect(setOccurrenceSession).toHaveBeenCalledWith(USER, 'occ-today', currentSession);
    expect(setOccurrenceStatus).toHaveBeenCalledWith(USER, 'occ-today', 'done');
  });
});

describe('scheduleUserRoutine', () => {
  const SCHEDULE: UserRoutineScheduleInput = { days: ['mon', 'wed', 'fri'], time_of_day: 'evening' };

  it('returns 404 for a routine that is not this user’s', async () => {
    getUserRoutineRow.mockResolvedValue(null);
    expect(await scheduleUserRoutine(USER, 'not-mine', { days: ['mon'] })).toEqual({ ok: false, status: 404 });
  });

  it('returns 409 when there is no active plan', async () => {
    getUserRoutineRow.mockResolvedValue(routineRow());
    getActivePlan.mockResolvedValue(null);
    expect(await scheduleUserRoutine(USER, ROUTINE_ID, { days: ['mon'] })).toEqual({ ok: false, status: 409 });
  });

  it('encodes days + time_of_day into the SAME RRULE grammar plan schedules already use', async () => {
    getUserRoutineRow.mockResolvedValue(routineRow({ activity_id: 'act-1', name: 'Piano practice' }));
    getUserActivity.mockResolvedValue(activity({ activity_id: 'act-1', plan_id: 'plan-active' }));
    const result = await scheduleUserRoutine(USER, ROUTINE_ID, SCHEDULE);
    expect(result).toEqual({ ok: true });
    expect(updateCompanionActivity).toHaveBeenCalledWith(USER, 'act-1', {
      title: 'Piano practice',
      schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', time_of_day: 'evening' },
    });
  });

  it('materializes the remaining week via ensureHorizon, honoring an extended plan horizon', async () => {
    getUserRoutineRow.mockResolvedValue(routineRow({ activity_id: 'act-1' }));
    getUserActivity.mockResolvedValue(activity({ activity_id: 'act-1', plan_id: 'plan-active' }));
    getActivePlan.mockResolvedValue({ ...ACTIVE_PLAN, horizon_days: 14 });
    await scheduleUserRoutine(USER, ROUTINE_ID, SCHEDULE);
    expect(ensureHorizon).toHaveBeenCalledWith(USER, 14);
  });

  it('falls back to DEFAULT_HORIZON_DAYS when the active plan carries no horizon_days', async () => {
    getUserRoutineRow.mockResolvedValue(routineRow({ activity_id: 'act-1' }));
    getUserActivity.mockResolvedValue(activity({ activity_id: 'act-1', plan_id: 'plan-active' }));
    getActivePlan.mockResolvedValue({ plan_id: 'plan-active', version: 1, status: 'active' });
    await scheduleUserRoutine(USER, ROUTINE_ID, SCHEDULE);
    expect(ensureHorizon).toHaveBeenCalledWith(USER, 7);
  });

  it('mints a companion lazily on first schedule, same as first run does', async () => {
    getUserRoutineRow.mockResolvedValue(routineRow({ activity_id: null, name: 'Fresh routine' }));
    mintCompanionActivity.mockResolvedValue(activity({ activity_id: 'act-brand-new' }));
    await scheduleUserRoutine(USER, ROUTINE_ID, SCHEDULE);
    expect(mintCompanionActivity).toHaveBeenCalledWith(USER, 'plan-active', ROUTINE_ID, 'Fresh routine', undefined);
    expect(updateCompanionActivity).toHaveBeenCalledWith(
      USER,
      'act-brand-new',
      expect.objectContaining({ schedule: expect.objectContaining({ recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' }) }),
    );
  });
});

describe('unscheduleUserRoutine', () => {
  it('returns 404 for a routine that is not this user’s', async () => {
    getUserRoutineRow.mockResolvedValue(null);
    expect(await unscheduleUserRoutine(USER, 'not-mine')).toEqual({ ok: false, status: 404 });
  });

  it('is an idempotent success for a routine with no companion — nothing to unschedule', async () => {
    getUserRoutineRow.mockResolvedValue(routineRow({ activity_id: null }));
    expect(await unscheduleUserRoutine(USER, ROUTINE_ID)).toEqual({ ok: true });
    expect(updateCompanionActivity).not.toHaveBeenCalled();
    expect(deleteFutureCompanionOccurrences).not.toHaveBeenCalled();
  });

  it('reverts the recurrence and removes only FUTURE pending occurrences on the companion', async () => {
    getUserRoutineRow.mockResolvedValue(routineRow({ activity_id: 'act-1' }));
    await unscheduleUserRoutine(USER, ROUTINE_ID);
    expect(updateCompanionActivity).toHaveBeenCalledWith(USER, 'act-1', { schedule: { recurrence: '' } });
    // The repo call itself is scoped to status='pending' AND date >= fromDate (repos/user-routines.ts) —
    // logged/done history is never in scope for this delete, by construction of that query.
    expect(deleteFutureCompanionOccurrences).toHaveBeenCalledWith(USER, 'act-1', '2026-09-01');
  });
});
