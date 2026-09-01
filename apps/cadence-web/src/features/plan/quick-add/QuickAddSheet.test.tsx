/**
 * The ＋ sheet after the 2026-09-01 redesign: quick adds derive from what's tracked, the plan's
 * own activities are never listed (the trail owns their buttons), and the inherited guarantees
 * hold — a failed plan read is never dressed as an empty one, the free line reads nothing from
 * the server so it works in every state, and loading shows shapes, never typing dots.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const usePlan = vi.fn();
const useNutritionDay = vi.fn();
vi.mock('../../../lib/query/index.ts', () => ({
  usePlan: () => usePlan(),
  useNutritionDay: () => useNutritionDay(),
  useInvalidateNutritionDay: () => vi.fn(),
  useUploadProgressPhoto: () => ({ mutateAsync: vi.fn(async () => null), isPending: false }),
}));

const logAdhoc = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
const logWater = vi.fn(async (..._a: unknown[]) => 750);
const getProgressPhotosStatus = vi.fn(async (..._a: unknown[]) => ({ enabled: false, count: 0, next_due: null }));
// The sheet's own lifted fetch (device-test fix, 2026-09-01 — DoNowSection used to fetch this
// itself and pop the layout when it resolved): drives BOTH the pill's suppression (a pinned item)
// and the "Calming techniques" row (any tool item at all). Screen 2 (QuickAddTense) reads the same
// endpoint again, scoped to its own area, for "Take me on one" — empty by default so neither ever
// renders here unless a test says so; QuickAddTense's own filtering/rendering is
// QuickAddTense.test.tsx's job, and DoNowSection's rendering (unmocked below) is exercised directly
// by the calming-row tests at the end of this file.
const getNowMenu = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
// The express-lane pill's own read (QuickAddPill, Activity Builder W2-B) — empty by default so it
// stays invisible in every test that isn't specifically about it; its own thresholds/rendering
// are QuickAddPill.test.tsx's job.
const getRoutines = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
// The pill's play-then-credit path (useRoutinePlay, wired in the sheet at integration): session
// fetch + the credit write. Defaults are the happy path; the failure test overrides per-case.
const getRoutineSession = vi.fn(async (..._a: unknown[]): Promise<{ ok: boolean; session: unknown }> => ({
  ok: true,
  session: { blocks: [{ label: '', items: [{ name: 'warm-up' }] }], note: '', generated_at: '', version: 1 },
}));
const logDid = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
// Screen 2's "Yours" tier (Activity Builder wave 3) — same empty-by-default treatment as
// `getRoutines`: its own rendering is QuickAddTense.test.tsx's job.
const listUserRoutines = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
const logUserRoutineRun = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
// The Apple Health pull's own read — same empty-by-default treatment; its own filter/rendering is
// QuickAddTense.test.tsx's job. Real `getWorkoutHistory` throws on failure, but the mock default
// here just resolves empty, same as every other "nothing to offer" default in this file.
const getWorkoutHistory = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
vi.mock('../../../lib/api.ts', () => ({
  logAdhoc: (...a: unknown[]) => logAdhoc(...a),
  logWater: (...a: unknown[]) => logWater(...a),
  recordWeighInToday: vi.fn(async () => ({ weight_kg: 88 })),
  getUnits: vi.fn(async () => null),
  getProgressPhotosStatus: (...a: unknown[]) => getProgressPhotosStatus(...a),
  getNowMenu: (...a: unknown[]) => getNowMenu(...a),
  getRoutines: (...a: unknown[]) => getRoutines(...a),
  getRoutineSession: (...a: unknown[]) => getRoutineSession(...a),
  logDid: (...a: unknown[]) => logDid(...a),
  listUserRoutines: (...a: unknown[]) => listUserRoutines(...a),
  logUserRoutineRun: (...a: unknown[]) => logUserRoutineRun(...a),
  getWorkoutHistory: (...a: unknown[]) => getWorkoutHistory(...a),
}));
// The real player is its own well-tested surface — here it's a stub with the two controls the
// play-then-credit contract cares about, so the sheet test can press "finish" and assert the wire.
vi.mock('../../walkthrough/Walkthrough.tsx', () => ({
  Walkthrough: ({ title, onComplete, onClose }: { title: string; onComplete: () => void; onClose: () => void }) => (
    <div>
      <b>{`playing: ${title}`}</b>
      <button onClick={onComplete}>finish-walkthrough</button>
      <button onClick={onClose}>close-walkthrough</button>
    </div>
  ),
}));
// DoNowSection is intentionally UNMOCKED here (unlike QuickAddSheet.presses.test.tsx, which never
// opens the calming sub-screen): it's now purely presentational, and the calming-row tests at the
// end of this file need its real pinned-item/rows rendering and its real Walkthrough hookup (the
// player itself is the stub above) to press "row → sub-screen → item → finish" end to end.

const { QuickAddSheet } = await import('./QuickAddSheet.tsx');

const activity = (over: Record<string, unknown> = {}) => ({
  activity_id: 'a1',
  title: 'Easy run',
  kind: 'user',
  cadence: 'weekly',
  recurrence: '',
  area: 'movement',
  ...over,
});

// A routine eligible for the express-lane pill (QuickAddPill) — finishes past its floor, steps
// non-empty. Only used by the two sheet-level pill tests at the end of this file.
const routine = (over: Record<string, unknown> = {}) => ({
  commitment_id: 'c1',
  activity_id: 'a1',
  title: 'Easy 5k',
  area: 'movement',
  steps: ['warm-up', 'zone 2', 'stretch'],
  finishes: 11,
  last_done: '2026-08-30',
  on_plan: true,
  ...over,
});

// A now-menu tool item (@cadence/shared's NowMenuItem) — the "Calming techniques" row's own
// signal, and DoNowSection's content once that row is pressed. Only used by the calming-row tests
// at the end of this file.
const nowMenuItem = (over: Record<string, unknown> = {}) => ({
  id: 'n1',
  label: 'Three long exhales',
  area: 'mind',
  action: { kind: 'tool', tool: 'breathing', params: {} },
  ...over,
});

const basePlan = (activities: unknown[] = []) => ({
  hasPlan: true,
  stage: 'committed',
  activities,
  week: [],
  consistency: { kept: 0, window: 7 },
});

function mount(
  state: { plan?: unknown; planError?: Error | null; day?: unknown },
  props: Partial<{
    onClose: () => void;
    onLogged: () => void;
    onOpenFood: () => void;
    onSteer: (text: string) => void;
    onBuild: (seed?: unknown) => void;
  }> = {},
) {
  usePlan.mockReturnValue({ data: state.plan, error: state.planError ?? null });
  useNutritionDay.mockReturnValue({ data: state.day });
  return render(
    <QuickAddSheet onClose={props.onClose ?? (() => {})} onLogged={props.onLogged ?? (() => {})} {...props} />,
  );
}

/** Every mount fires the photos-status effect; settle it so no state lands after a test ends. */
const settled = () => waitFor(() => expect(getProgressPhotosStatus).toHaveBeenCalled());

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('QuickAddSheet', () => {
  it('never shows a movement activity’s own title — it would read as a second, different button', async () => {
    // A lone "Easy run" is a task NAME that already sits on the trail with its own button
    // (code review, 2026-09-01): the quick-add row must wear the TYPE of the thing instead, and
    // the literal title must not appear anywhere in the sheet.
    mount({ plan: basePlan([activity({ title: 'Easy run' })]), day: null });
    expect(screen.getByLabelText('A run')).toBeTruthy();
    expect(screen.queryByText('Easy run')).toBeNull();
    await settled();
  });

  it('never turns two movement activities into two rows — one area, one generic noun', async () => {
    // Two distinct titles (mapping to two distinct TYPES) in the same area: nothing to single
    // out, so the row wears the area's own floor rather than either activity's name.
    mount({
      plan: basePlan([activity({ title: 'Easy run' }), activity({ activity_id: 'a2', title: 'Strength' })]),
      day: null,
    });
    expect(screen.queryByText('Easy run')).toBeNull();
    expect(screen.queryByText('Strength')).toBeNull();
    expect(screen.getByText('A workout')).toBeTruthy();
    await settled();
  });

  it('derives rows from what’s tracked: water, meal, a noun named after the practice activity', async () => {
    mount(
      {
        plan: basePlan([activity({ area: 'practice', title: 'Piano practice', goal_title: 'Learn piano' })]),
        day: { date: '2026-09-01', meals: [], has_recent_water: true, has_recent_food: true, water_ml: 500 },
      },
      { onOpenFood: () => {} },
    );
    expect(screen.getByText('A glass of water')).toBeTruthy();
    expect(screen.getByText('0.5 L today')).toBeTruthy();
    expect(screen.getByText('Log a meal')).toBeTruthy();
    // "Piano practice" strips its generic suffix — the row is named after the thing, not the verb.
    expect(screen.getByText('Piano')).toBeTruthy();
    expect(screen.getByText('toward Learn piano')).toBeTruthy();
    await settled();
  });

  it('one tap on the water row pours one glass', async () => {
    mount({ plan: basePlan(), day: { date: '2026-09-01', meals: [], has_recent_water: true, water_ml: 500 } });
    fireEvent.click(screen.getByLabelText('Add a glass of water'));
    await waitFor(() => expect(logWater).toHaveBeenCalledWith(250));
  });

  it('tapping a noun row opens screen 2 — it never logs anything by itself', async () => {
    mount({ plan: basePlan([activity()]), day: null });
    fireEvent.click(screen.getByLabelText('A run'));
    expect(screen.getByText('I went for one')).toBeTruthy();
    expect(logAdhoc).not.toHaveBeenCalled();
    await settled();
  });

  it('screen 2’s back affordance returns to the noun list', async () => {
    mount({ plan: basePlan([activity()]), day: null });
    fireEvent.click(screen.getByLabelText('A run'));
    fireEvent.click(screen.getByLabelText('Back'));
    expect(screen.getByLabelText('A run')).toBeTruthy();
    await settled();
  });

  it('a duration chip on screen 2 composes the log text, then closes the sheet and tells the host', async () => {
    const onLogged = vi.fn();
    const onClose = vi.fn();
    mount({ plan: basePlan([activity()]), day: null }, { onLogged, onClose });
    fireEvent.click(screen.getByLabelText('A run'));
    fireEvent.click(screen.getByText('30 min'));
    await waitFor(() => expect(logAdhoc).toHaveBeenCalledWith('Run — 30 min', undefined, 'movement'));
    expect(onLogged).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('screen 2’s free-typed line still logs off-plan, tagged with its area', async () => {
    const onLogged = vi.fn();
    mount({ plan: basePlan([activity()]), day: null }, { onLogged });
    fireEvent.click(screen.getByLabelText('A run'));
    fireEvent.change(screen.getByPlaceholderText(/ran 5k/), { target: { value: 'hotel gym, 30 min' } });
    fireEvent.click(screen.getByText('Log'));
    await waitFor(() => expect(logAdhoc).toHaveBeenCalledWith('hotel gym, 30 min', undefined, 'movement'));
    expect(onLogged).toHaveBeenCalled();
  });

  it('"Tell me instead" hands the coach a seed and closes the sheet, when the host wired a door', async () => {
    const onSteer = vi.fn();
    const onClose = vi.fn();
    mount(
      {
        plan: basePlan([activity({ area: 'practice', title: 'Piano practice', goal_title: 'Learn piano' })]),
        day: null,
      },
      { onSteer, onClose },
    );
    fireEvent.click(screen.getByLabelText('Piano'));
    fireEvent.click(screen.getByLabelText('Tell me instead'));
    expect(onSteer).toHaveBeenCalledWith('I want to log some piano time');
    expect(onClose).toHaveBeenCalled();
  });

  it('hides "Tell me instead" on screen 2 when the host has no door for it', async () => {
    mount({ plan: basePlan([activity()]), day: null });
    fireEvent.click(screen.getByLabelText('A run'));
    expect(screen.queryByLabelText('Tell me instead')).toBeNull();
    await settled();
  });

  it('"Build my own" → Blank hands the host onBuild(undefined) and closes the sheet, when wired', async () => {
    const onBuild = vi.fn();
    const onClose = vi.fn();
    mount({ plan: basePlan([activity()]), day: null }, { onBuild, onClose });
    fireEvent.click(screen.getByLabelText('A run'));
    fireEvent.click(await screen.findByLabelText('Build my own'));
    fireEvent.click(screen.getByText('Blank'));
    expect(onBuild).toHaveBeenCalledWith(undefined);
    expect(onClose).toHaveBeenCalled();
  });

  it('hides "Build my own" on screen 2 when the host has no door for it', async () => {
    mount({ plan: basePlan([activity()]), day: null });
    fireEvent.click(screen.getByLabelText('A run'));
    await settled();
    expect(screen.queryByLabelText('Build my own')).toBeNull();
  });

  it('the meal row is a door to the food module, and only exists when the host has one', async () => {
    const onOpenFood = vi.fn();
    const dayData = { date: '2026-09-01', meals: [], has_recent_food: true };
    mount({ plan: basePlan(), day: dayData }, { onOpenFood });
    fireEvent.click(screen.getByText('Log a meal'));
    expect(onOpenFood).toHaveBeenCalled();
    cleanup();
    mount({ plan: basePlan(), day: dayData });
    expect(screen.queryByText('Log a meal')).toBeNull();
    await settled();
  });

  it('offers the photo row only behind the opt-in', async () => {
    getProgressPhotosStatus.mockResolvedValue({ enabled: true, count: 2, next_due: null });
    mount({ plan: basePlan(), day: null });
    expect(await screen.findByText('Take a progress photo')).toBeTruthy();
    cleanup();
    getProgressPhotosStatus.mockResolvedValue({ enabled: false, count: 0, next_due: null });
    mount({ plan: basePlan(), day: null });
    await settled();
    expect(screen.queryByText('Take a progress photo')).toBeNull();
  });

  it('never reports a failed plan read as nothing-to-add', async () => {
    mount({ plan: undefined, planError: new Error('offline'), day: null });
    expect(screen.queryByText(/Nothing to quick-add/)).toBeNull();
    expect(screen.getByText(/Couldn't reach your plan just now/)).toBeTruthy();
    await settled();
  });

  it('shows row shapes, not typing dots, on the true first load', async () => {
    const { container } = mount({ plan: undefined, planError: null, day: null });
    expect(container.querySelector('.typing')).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    await settled();
  });

  it('says so honestly when there is nothing tracked to offer', async () => {
    mount({ plan: basePlan(), day: null });
    expect(screen.getByText(/Nothing to quick-add yet/)).toBeTruthy();
    await settled();
  });

  it('keeps the free line usable in every state — it reads nothing from the server', async () => {
    for (const state of [
      { plan: undefined, planError: null, day: null },
      { plan: undefined, planError: new Error('offline'), day: null },
      { plan: basePlan(), day: null },
    ]) {
      const { container } = mount(state);
      expect(container.querySelector('.ld-free')).toBeTruthy();
      await settled();
      cleanup();
    }
  });

  it('the express-lane pill renders above the derived quick-add rows', async () => {
    getRoutines.mockResolvedValue([routine()]);
    mount({ plan: basePlan([activity()]), day: null });
    const pill = await screen.findByLabelText('Easy 5k');
    const derivedRow = screen.getByLabelText('A run');
    // DOCUMENT_POSITION_FOLLOWING on derivedRow (relative to pill) means the pill comes first in
    // document order — "above" the rows it's meant to sit over.
    expect(pill.compareDocumentPosition(derivedRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await settled();
  });

  it("stands down when the coach's own pinned now-menu item is present — her pick outranks a usage-stats shortcut", async () => {
    getRoutines.mockResolvedValue([routine()]);
    getNowMenu.mockResolvedValueOnce([nowMenuItem({ pinned: true })]);
    mount({ plan: basePlan([activity()]), day: null });
    await waitFor(() => expect(getRoutines).toHaveBeenCalled());
    expect(screen.queryByLabelText('Easy 5k')).toBeNull();
    await settled();
  });

  /** The integration wiring itself, pressed end to end: pill → session fetch → player → finish →
   *  credit the routine's activity, then the sheet's "log it, then close" contract — in order. */
  it('pressing the pill plays the routine and finishing credits it, then logs and closes', async () => {
    const calls: string[] = [];
    getRoutines.mockResolvedValue([routine()]);
    logDid.mockImplementation(async (..._a: unknown[]) => {
      calls.push('logDid');
      return { ok: true };
    });
    mount(
      { plan: basePlan([activity()]), day: null },
      { onLogged: () => calls.push('onLogged'), onClose: () => calls.push('onClose') },
    );

    fireEvent.click(await screen.findByLabelText('Easy 5k'));
    await waitFor(() => expect(getRoutineSession).toHaveBeenCalledWith('c1'));
    fireEvent.click(await screen.findByText('finish-walkthrough'));

    await waitFor(() => expect(calls).toEqual(['logDid', 'onLogged', 'onClose']));
    expect(logDid).toHaveBeenCalledWith('a1');
    await settled();
  });

  it('a failed session fetch on the pill shows the honest line and logs nothing', async () => {
    getRoutines.mockResolvedValue([routine()]);
    getRoutineSession.mockResolvedValueOnce({ ok: false, session: null });
    const onClose = vi.fn();
    mount({ plan: basePlan([activity()]), day: null }, { onClose });

    fireEvent.click(await screen.findByLabelText('Easy 5k'));
    expect(await screen.findByText(/Couldn't open that one just now/)).toBeTruthy();
    expect(logDid).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await settled();
  });

  /** The demotion itself (device-test ruling, 2026-09-01): a menu of mind tools the coach composed
   *  is ONE labelled row on screen 1, never a top-level section — no item's own label leaks out. */
  it('a present-tense menu demotes to the "Calming techniques" row — no item label at top level', async () => {
    getNowMenu.mockResolvedValueOnce([nowMenuItem(), nowMenuItem({ id: 'n2', label: 'A short sit' })]);
    mount({ plan: basePlan(), day: null });
    expect(await screen.findByLabelText('Calming techniques')).toBeTruthy();
    expect(screen.getByText('from your coach — for right now')).toBeTruthy();
    expect(screen.queryByText('Three long exhales')).toBeNull();
    expect(screen.queryByText('A short sit')).toBeNull();
    await settled();
  });

  it('drops an activity-kind now-menu item before it ever reaches the row or the sub-screen', async () => {
    // The tool-kind filter moved up here from DoNowSection (device-test fix, 2026-09-01) — an
    // activity row needs a deep-link into that task's own flow, which doesn't exist yet.
    getNowMenu.mockResolvedValueOnce([
      { id: 'a1', label: 'Deleted task', area: 'movement', action: { kind: 'activity', activityId: 'x' } },
    ]);
    mount({ plan: basePlan(), day: null });
    await waitFor(() => expect(getNowMenu).toHaveBeenCalled());
    // No tool items survived the filter — the row itself never appears, the same "no claim"
    // reading an empty menu gets.
    expect(screen.queryByLabelText('Calming techniques')).toBeNull();
    await settled();
  });

  it('shows no "Calming techniques" row on an empty menu, or on a failed fetch', async () => {
    mount({ plan: basePlan(), day: null }); // getNowMenu defaults to [] — the empty-menu case
    await waitFor(() => expect(getNowMenu).toHaveBeenCalled());
    expect(screen.queryByLabelText('Calming techniques')).toBeNull();
    cleanup();

    getNowMenu.mockRejectedValueOnce(new Error('offline'));
    mount({ plan: basePlan(), day: null });
    await waitFor(() => expect(getNowMenu).toHaveBeenCalled());
    expect(screen.queryByLabelText('Calming techniques')).toBeNull();
    await settled();
  });

  it('pressing the row opens the sub-screen with the coach’s items', async () => {
    getNowMenu.mockResolvedValueOnce([nowMenuItem(), nowMenuItem({ id: 'n2', label: 'A short sit' })]);
    mount({ plan: basePlan(), day: null });
    fireEvent.click(await screen.findByLabelText('Calming techniques'));
    expect(screen.getByLabelText('Back')).toBeTruthy();
    expect(screen.getByText('Three long exhales')).toBeTruthy();
    expect(screen.getByText('A short sit')).toBeTruthy();
    await settled();
  });

  it('pressing an item plays it, and finishing logs then closes the whole sheet — unchanged contract', async () => {
    const onLogged = vi.fn();
    const onClose = vi.fn();
    getNowMenu.mockResolvedValueOnce([nowMenuItem()]);
    mount({ plan: basePlan(), day: null }, { onLogged, onClose });
    fireEvent.click(await screen.findByLabelText('Calming techniques'));
    fireEvent.click(screen.getByLabelText('Three long exhales'));
    expect(screen.getByText('playing: Three long exhales')).toBeTruthy();
    fireEvent.click(screen.getByText('finish-walkthrough'));
    expect(onLogged).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    await settled();
  });

  it('back returns to screen 1, with the row and everything else intact', async () => {
    getNowMenu.mockResolvedValueOnce([nowMenuItem()]);
    mount({ plan: basePlan([activity()]), day: null });
    fireEvent.click(await screen.findByLabelText('Calming techniques'));
    fireEvent.click(screen.getByLabelText('Back'));
    expect(screen.getByLabelText('Calming techniques')).toBeTruthy();
    expect(screen.getByLabelText('A run')).toBeTruthy();
    await settled();
  });
});
