/**
 * The trail's two gestures, routed, and the edits that follow — with the API mocked. The cases
 * worth pinning are the ones that go wrong silently: a future tap opening the start sheet, a
 * "do it now" that copies instead of moving, a skipped row opened as-is (the start sheet would
 * refuse it), and a failed edit closing the sheet as though it had landed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { PlanOccurrence, PlanViewData } from '../../../lib/api.ts';

const moveOccurrence = vi.fn();
const duplicateOccurrence = vi.fn();
const deleteOccurrence = vi.fn();
const setOccurrence = vi.fn();
vi.mock('../../../lib/api/occurrence-edit.ts', () => ({
  moveOccurrence: (...a: unknown[]) => moveOccurrence(...a),
  duplicateOccurrence: (...a: unknown[]) => duplicateOccurrence(...a),
  deleteOccurrence: (...a: unknown[]) => deleteOccurrence(...a),
}));
vi.mock('../../../lib/api/plan.ts', () => ({ setOccurrence: (...a: unknown[]) => setOccurrence(...a) }));

const { useTaskEdits } = await import('./useTaskEdits.ts');

const TODAY = '2026-09-07';
const occ = (over: Partial<PlanOccurrence> = {}): PlanOccurrence => ({
  occurrence_id: 'o-tmrw',
  activity_id: 'run',
  title: 'Easy run',
  kind: 'user',
  status: 'pending',
  ...over,
});
const TODAYS_SKIPPED = occ({ occurrence_id: 'o-today', status: 'skipped' });
const PLAN: PlanViewData = {
  hasPlan: true,
  stage: 'committed',
  activities: [],
  consistency: { kept: 0, window: 7 },
  week: [
    { date: '2026-09-07', weekday: 'Mon', dayNum: 7, isToday: true, occurrences: [TODAYS_SKIPPED] },
    { date: '2026-09-08', weekday: 'Tue', dayNum: 8, isToday: false, occurrences: [occ()] },
  ],
};

function mount() {
  const refresh = vi.fn();
  const openTask = vi.fn();
  const hook = renderHook(() => useTaskEdits({ plan: PLAN, refresh, openTask }));
  return { ...hook, refresh, openTask };
}

beforeEach(() => {
  vi.clearAllMocks();
  moveOccurrence.mockResolvedValue({ ok: true, occurrence_id: 'o-tmrw' });
  duplicateOccurrence.mockResolvedValue({ ok: true, occurrence_id: 'o-copy' });
  deleteOccurrence.mockResolvedValue({ ok: true });
  setOccurrence.mockResolvedValue(undefined);
});

describe('useTaskEdits — routing', () => {
  it("today's date comes from the week on screen", () => {
    expect(mount().result.current.todayIso).toBe(TODAY);
  });

  it('a tap on today opens the task; a tap on a future day opens the preview instead', () => {
    const h = mount();
    act(() => h.result.current.tap(TODAYS_SKIPPED, '2026-09-07'));
    expect(h.openTask).toHaveBeenCalledWith(TODAYS_SKIPPED);
    expect(h.result.current.sheet).toBeNull();

    act(() => h.result.current.tap(occ(), '2026-09-08'));
    expect(h.openTask).toHaveBeenCalledTimes(1);
    expect(h.result.current.sheet).toMatchObject({ kind: 'preview', date: '2026-09-08' });
  });

  it('a tap on a day already gone opens the task — logging late is fine', () => {
    const h = mount();
    act(() => h.result.current.tap(occ({ occurrence_id: 'o-old' }), '2026-09-02'));
    expect(h.openTask).toHaveBeenCalledTimes(1);
  });

  it('a hold opens the menu on its first screen; the preview door jumps to the ask', () => {
    const h = mount();
    act(() => h.result.current.hold(occ(), '2026-09-08'));
    expect(h.result.current.sheet).toMatchObject({ kind: 'menu', screen: 'menu' });
    act(() => h.result.current.tap(occ(), '2026-09-08'));
    act(() => h.result.current.askDoNow());
    expect(h.result.current.sheet).toMatchObject({ kind: 'menu', screen: 'do-now' });
  });
});

describe('useTaskEdits — do it now', () => {
  it("moves tomorrow's row onto TODAY (never a copy), refetches, and opens the same row", async () => {
    const h = mount();
    act(() => h.result.current.hold(occ(), '2026-09-08'));
    await act(() => h.result.current.doNow());
    expect(moveOccurrence).toHaveBeenCalledWith('o-tmrw', TODAY);
    expect(duplicateOccurrence).not.toHaveBeenCalled();
    expect(h.refresh).toHaveBeenCalled();
    expect(h.openTask).toHaveBeenCalledWith(occ());
    expect(h.result.current.sheet).toBeNull();
  });

  it('when today already holds it, opens that row instead — and un-skips it if it was skipped', async () => {
    moveOccurrence.mockResolvedValue({
      ok: false,
      reason: 'already_there',
      existing_occurrence_id: 'o-today',
      existing_status: 'skipped',
    });
    const h = mount();
    act(() => h.result.current.hold(occ(), '2026-09-08'));
    await act(() => h.result.current.doNow());
    expect(setOccurrence).toHaveBeenCalledWith('o-today', 'pending');
    expect(h.openTask).toHaveBeenCalledWith({ ...TODAYS_SKIPPED, status: 'pending' });
  });

  it('a failed move says so and keeps the sheet up', async () => {
    moveOccurrence.mockResolvedValue({ ok: false, reason: 'out_of_range' });
    const h = mount();
    act(() => h.result.current.hold(occ(), '2026-09-08'));
    await act(() => h.result.current.doNow());
    expect(h.result.current.error).toMatch(/isn't in this week/);
    expect(h.result.current.sheet).not.toBeNull();
    expect(h.openTask).not.toHaveBeenCalled();
  });

  it("opening today's skipped row sets it back to pending first — the start sheet only starts pending", async () => {
    const h = mount();
    act(() => h.result.current.hold(TODAYS_SKIPPED, '2026-09-07'));
    await act(async () => h.result.current.open('o-today'));
    expect(setOccurrence).toHaveBeenCalledWith('o-today', 'pending');
    expect(h.refresh).toHaveBeenCalled();
    expect(h.openTask).toHaveBeenCalledWith({ ...TODAYS_SKIPPED, status: 'pending' });
  });

  it('opening a pending row touches nothing', async () => {
    const h = mount();
    act(() => h.result.current.hold(occ(), '2026-09-08'));
    await act(async () => h.result.current.open('o-tmrw'));
    expect(setOccurrence).not.toHaveBeenCalled();
    expect(h.openTask).toHaveBeenCalledWith(occ());
  });
});

describe('useTaskEdits — move, copy, delete', () => {
  it('a landed move closes and refetches', async () => {
    const h = mount();
    act(() => h.result.current.hold(occ(), '2026-09-08'));
    await act(() => h.result.current.move('2026-09-10'));
    expect(moveOccurrence).toHaveBeenCalledWith('o-tmrw', '2026-09-10');
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(h.result.current.sheet).toBeNull();
  });

  it('a day that already has it says so, by name', async () => {
    moveOccurrence.mockResolvedValue({
      ok: false,
      reason: 'already_there',
      existing_occurrence_id: 'x',
      existing_status: 'pending',
    });
    const h = mount();
    act(() => h.result.current.hold(occ(), '2026-09-08'));
    await act(() => h.result.current.move('2026-09-07'));
    expect(h.result.current.error).toBe('That day already has Easy run.');
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it('a copy lands and refetches', async () => {
    const h = mount();
    act(() => h.result.current.hold(occ(), '2026-09-08'));
    await act(() => h.result.current.duplicate('2026-09-10'));
    expect(duplicateOccurrence).toHaveBeenCalledWith('o-tmrw', '2026-09-10');
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it('a delete lands and refetches; a network failure says so', async () => {
    const h = mount();
    act(() => h.result.current.hold(occ(), '2026-09-08'));
    await act(() => h.result.current.remove());
    expect(deleteOccurrence).toHaveBeenCalledWith('o-tmrw');
    expect(h.result.current.sheet).toBeNull();

    deleteOccurrence.mockRejectedValue(new Error('offline'));
    act(() => h.result.current.hold(occ(), '2026-09-08'));
    await act(() => h.result.current.remove());
    expect(h.result.current.error).toMatch(/didn't take/);
    expect(h.result.current.sheet).not.toBeNull();
  });
});
