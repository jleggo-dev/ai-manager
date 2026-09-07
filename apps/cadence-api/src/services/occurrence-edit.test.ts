/**
 * The hold menu's server rules, with the database mocked away. What is worth pinning is the
 * one rule that never throws when it is wrong: the week window. A day just past today, or one
 * past the horizon, has to come back as `out_of_range` rather than quietly moving a task onto a
 * day the trail will never draw — and a same-activity collision must come back as a conflict
 * naming the row, never as a second breakfast on the same day.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getActivePlan = vi.fn();
const getUser = vi.fn();
const getOccurrenceForEdit = vi.fn();
const findOccurrenceOnDate = vi.fn();
const moveOccurrenceDate = vi.fn();
const duplicateOccurrenceTo = vi.fn();
const deleteOccurrence = vi.fn();

// plan-horizon.ts reaches the DB module on import; only its constant is wanted here.
vi.mock('./plan-horizon.ts', () => ({ DEFAULT_HORIZON_DAYS: 7 }));
vi.mock('../repos/plans.ts', () => ({ getActivePlan: (...a: unknown[]) => getActivePlan(...a) }));
vi.mock('../repos/users.ts', () => ({ getUser: (...a: unknown[]) => getUser(...a) }));
vi.mock('../repos/occurrence-edit.ts', () => ({
  getOccurrenceForEdit: (...a: unknown[]) => getOccurrenceForEdit(...a),
  findOccurrenceOnDate: (...a: unknown[]) => findOccurrenceOnDate(...a),
  moveOccurrenceDate: (...a: unknown[]) => moveOccurrenceDate(...a),
  duplicateOccurrenceTo: (...a: unknown[]) => duplicateOccurrenceTo(...a),
  deleteOccurrence: (...a: unknown[]) => deleteOccurrence(...a),
}));

const { dateInWindow, editWindow, moveOccurrence, duplicateOccurrence, removeOccurrence } =
  await import('./occurrence-edit.ts');

const ROW = {
  occurrence_id: 'occ-1',
  activity_id: 'act-1',
  date: '2026-09-09',
  status: 'pending',
  title: 'Strength — lower',
  recurrence: 'FREQ=WEEKLY;BYDAY=WE',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // Monday 2026-09-07, mid-afternoon UTC — the user is in UTC, so today is the 7th.
  vi.setSystemTime(new Date('2026-09-07T15:00:00Z'));
  getActivePlan.mockResolvedValue({ plan_id: 'p1', horizon_days: 7 });
  getUser.mockResolvedValue({ timezone: 'UTC' });
  getOccurrenceForEdit.mockResolvedValue(ROW);
  findOccurrenceOnDate.mockResolvedValue(null);
  moveOccurrenceDate.mockResolvedValue(true);
  duplicateOccurrenceTo.mockResolvedValue('occ-copy');
  deleteOccurrence.mockResolvedValue(true);
});

describe('dateInWindow', () => {
  const w = { from: '2026-09-07', to: '2026-09-13' };
  it.each([
    ['2026-09-07', true],
    ['2026-09-13', true],
    ['2026-09-10', true],
    ['2026-09-06', false],
    ['2026-09-14', false],
  ])('%s → %s', (date, expected) => {
    expect(dateInWindow(date, w)).toBe(expected);
  });
});

describe('editWindow', () => {
  it("is today through the plan's horizon, in the user's zone", async () => {
    expect(await editWindow('u1')).toEqual({ from: '2026-09-07', to: '2026-09-13' });
  });

  it('follows an extended horizon', async () => {
    getActivePlan.mockResolvedValue({ plan_id: 'p1', horizon_days: 14 });
    expect(await editWindow('u1')).toEqual({ from: '2026-09-07', to: '2026-09-20' });
  });

  it('is null with no committed plan', async () => {
    getActivePlan.mockResolvedValue(null);
    expect(await editWindow('u1')).toBeNull();
  });

  it("uses the client's zone hint when the user has none stored", async () => {
    getUser.mockResolvedValue({ timezone: null });
    // 15:00Z on the 7th is already the 8th in Auckland (UTC+12).
    expect(await editWindow('u1', 'Pacific/Auckland')).toEqual({ from: '2026-09-08', to: '2026-09-14' });
  });
});

describe('moveOccurrence', () => {
  it('moves onto a day this week', async () => {
    expect(await moveOccurrence('u1', 'occ-1', '2026-09-11')).toEqual({ status: 'ok', occurrence_id: 'occ-1' });
    expect(moveOccurrenceDate).toHaveBeenCalledWith('u1', 'occ-1', '2026-09-11');
  });

  it('refuses yesterday and the day after the horizon', async () => {
    expect(await moveOccurrence('u1', 'occ-1', '2026-09-06')).toEqual({
      status: 'out_of_range',
      from: '2026-09-07',
      to: '2026-09-13',
    });
    expect(await moveOccurrence('u1', 'occ-1', '2026-09-14')).toMatchObject({ status: 'out_of_range' });
    expect(moveOccurrenceDate).not.toHaveBeenCalled();
  });

  it('onto its own day is a no-op that answers ok', async () => {
    expect(await moveOccurrence('u1', 'occ-1', '2026-09-09')).toEqual({ status: 'ok', occurrence_id: 'occ-1' });
    expect(moveOccurrenceDate).not.toHaveBeenCalled();
  });

  it('names the row already on that day instead of colliding with it', async () => {
    findOccurrenceOnDate.mockResolvedValue({ occurrence_id: 'occ-today', status: 'done' });
    expect(await moveOccurrence('u1', 'occ-1', '2026-09-07')).toEqual({
      status: 'conflict',
      existing_occurrence_id: 'occ-today',
      existing_status: 'done',
    });
    expect(moveOccurrenceDate).not.toHaveBeenCalled();
  });

  it("is not_found for a row that isn't this user's", async () => {
    getOccurrenceForEdit.mockResolvedValue(null);
    expect(await moveOccurrence('u1', 'occ-x', '2026-09-08')).toEqual({ status: 'not_found' });
  });

  it('is not_found with no plan to move within', async () => {
    getActivePlan.mockResolvedValue(null);
    expect(await moveOccurrence('u1', 'occ-1', '2026-09-08')).toEqual({ status: 'not_found' });
  });
});

describe('duplicateOccurrence', () => {
  it("answers with the COPY's id", async () => {
    expect(await duplicateOccurrence('u1', 'occ-1', '2026-09-12')).toEqual({ status: 'ok', occurrence_id: 'occ-copy' });
    expect(duplicateOccurrenceTo).toHaveBeenCalledWith('u1', 'occ-1', '2026-09-12');
  });

  it('a copy onto its own day is a conflict — the activity is already there', async () => {
    findOccurrenceOnDate.mockResolvedValue({ occurrence_id: 'occ-1', status: 'pending' });
    expect(await duplicateOccurrence('u1', 'occ-1', '2026-09-09')).toMatchObject({
      status: 'conflict',
      existing_occurrence_id: 'occ-1',
    });
    expect(duplicateOccurrenceTo).not.toHaveBeenCalled();
  });

  it('a race the pre-check missed still reads as the conflict it is', async () => {
    duplicateOccurrenceTo.mockResolvedValue(null);
    findOccurrenceOnDate
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ occurrence_id: 'occ-r', status: 'pending' });
    expect(await duplicateOccurrence('u1', 'occ-1', '2026-09-12')).toMatchObject({
      status: 'conflict',
      existing_occurrence_id: 'occ-r',
    });
  });

  it('holds the week window too', async () => {
    expect(await duplicateOccurrence('u1', 'occ-1', '2026-09-20')).toMatchObject({ status: 'out_of_range' });
  });
});

describe('removeOccurrence', () => {
  it('ok when a row went, not_found when nothing did', async () => {
    expect(await removeOccurrence('u1', 'occ-1')).toBe('ok');
    deleteOccurrence.mockResolvedValue(false);
    expect(await removeOccurrence('u1', 'occ-1')).toBe('not_found');
  });
});
