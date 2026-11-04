/**
 * "Every time" writes one sentence to the right row (walkthrough v3 Phase 6c, R5), with the
 * database mocked away. What matters: the ACTIVE plan's row for the session's commitment is the
 * one written (future sessions are prescribed from it), the same sentence twice is one, a full
 * instruction is refused rather than trimmed, and the sessions written ahead are forgotten so the
 * next open reads the new instruction. Nothing is written for a session that is not this user's.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getOccurrenceWithActivity = vi.fn();
const getUserActivity = vi.fn();
const getActiveActivityForCommitment = vi.fn();
const updateActivityHowTo = vi.fn();
const clearFuturePendingSessions = vi.fn();

vi.mock('../repos/occurrences.ts', () => ({
  getOccurrenceWithActivity: (...a: unknown[]) => getOccurrenceWithActivity(...a),
  clearFuturePendingSessions: (...a: unknown[]) => clearFuturePendingSessions(...a),
}));
vi.mock('../repos/activities.ts', () => ({
  getUserActivity: (...a: unknown[]) => getUserActivity(...a),
  getActiveActivityForCommitment: (...a: unknown[]) => getActiveActivityForCommitment(...a),
  updateActivityHowTo: (...a: unknown[]) => updateActivityHowTo(...a),
}));

const { keepHowTo } = await import('./activity-how-to.ts');

const OCC = { occurrence_id: 'o1', activity_id: 'a-old', date: '2026-11-02', title: 'Obstacle strength' };
const OLD_ROW = { activity_id: 'a-old', commitment_id: 'c1', title: 'Obstacle strength', how_to: null };
const ACTIVE_ROW = {
  activity_id: 'a-new',
  commitment_id: 'c1',
  title: 'Obstacle strength',
  how_to: 'dead hangs, not farmers carries',
};

beforeEach(() => {
  vi.clearAllMocks();
  getOccurrenceWithActivity.mockResolvedValue(OCC);
  getUserActivity.mockResolvedValue(OLD_ROW);
  getActiveActivityForCommitment.mockResolvedValue(ACTIVE_ROW);
  updateActivityHowTo.mockResolvedValue(true);
  clearFuturePendingSessions.mockResolvedValue(2);
});

describe('keepHowTo', () => {
  it('appends the sentence to the ACTIVE plan’s row for the commitment and clears the sessions written ahead', async () => {
    const r = await keepHowTo('u1', 'o1', 'alternate bench press and dumbbell row');
    expect(r).toEqual({
      status: 'written',
      how_to: 'dead hangs, not farmers carries; alternate bench press and dumbbell row',
      activity: 'Obstacle strength',
    });
    expect(getActiveActivityForCommitment).toHaveBeenCalledWith('u1', 'c1');
    expect(updateActivityHowTo).toHaveBeenCalledWith(
      'u1',
      'a-new',
      'dead hangs, not farmers carries; alternate bench press and dumbbell row',
    );
    // After the day being played, never the day itself.
    expect(clearFuturePendingSessions).toHaveBeenCalledWith('u1', 'a-new', '2026-11-02');
  });

  it('falls back to the session’s own row when the commitment is no longer on the active plan', async () => {
    getActiveActivityForCommitment.mockResolvedValue(null);
    const r = await keepHowTo('u1', 'o1', 'dead hang one set at a time');
    expect(r).toMatchObject({ status: 'written', how_to: 'dead hang one set at a time' });
    expect(updateActivityHowTo).toHaveBeenCalledWith('u1', 'a-old', 'dead hang one set at a time');
  });

  it('the same sentence twice is one: nothing written, nothing cleared', async () => {
    getActiveActivityForCommitment.mockResolvedValue({ ...ACTIVE_ROW, how_to: 'Dead hang one set at a time.' });
    const r = await keepHowTo('u1', 'o1', 'dead hang one set at a time');
    expect(r).toEqual({ status: 'present', how_to: 'Dead hang one set at a time.', activity: 'Obstacle strength' });
    expect(updateActivityHowTo).not.toHaveBeenCalled();
    expect(clearFuturePendingSessions).not.toHaveBeenCalled();
  });

  it('an instruction at its bound is refused whole — nothing written, nothing there dropped', async () => {
    getActiveActivityForCommitment.mockResolvedValue({ ...ACTIVE_ROW, how_to: 'x'.repeat(590) });
    const r = await keepHowTo('u1', 'o1', 'alternate bench press and dumbbell row');
    expect(r).toMatchObject({ status: 'full', how_to: 'x'.repeat(590) });
    expect(updateActivityHowTo).not.toHaveBeenCalled();
  });

  it.each([
    ['a session that is not this user’s', () => getOccurrenceWithActivity.mockResolvedValue(null)],
    ['an activity that is not this user’s', () => getUserActivity.mockResolvedValue(null)],
    ['a row that vanished under a replan', () => updateActivityHowTo.mockResolvedValue(false)],
  ])('%s is not_found, and nothing is cleared', async (_n, arrange) => {
    arrange();
    expect(await keepHowTo('u1', 'o1', 'alternate bench press and dumbbell row')).toEqual({ status: 'not_found' });
    expect(clearFuturePendingSessions).not.toHaveBeenCalled();
  });
});
