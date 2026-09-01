/**
 * Screen 2 — "the tense" (Activity Builder 2A): past above present. Pins the parts a mount test
 * can't leave to inspection — the composed log text, the coach hand-off's seed sentence, the
 * now-menu's area filter, and the empty-menu no-heading rule (DoNowSection's own rule, reused).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const logAdhoc = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
const getNowMenu = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
// The routines shelf's own three calls (Activity Builder 2A) — `getRoutines` defaults to `[]` so
// existing now-menu-only tests below are unaffected; `getRoutineSession`/`logDid` back the
// play-then-credit flow (useRoutinePlay.tsx) and only matter to the routine-specific tests.
const getRoutines = vi.fn(async (..._a: unknown[]) => [] as unknown[] | null);
const getRoutineSession = vi.fn(async (..._a: unknown[]) => ({ ok: true, session: null }) as unknown);
const logDid = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
// The "Yours" tier's own two calls (Activity Builder wave 3) — same no-claim default as `getRoutines`.
const listUserRoutines = vi.fn(async (..._a: unknown[]) => [] as unknown[] | null);
const logUserRoutineRun = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
// The Apple Health pull's own read — THROWS on failure (unlike everything else mocked here), so
// the default has to be a resolved empty array, not a rejected one, or every test that doesn't
// care about it would have to swallow an unhandled rejection.
const getWorkoutHistory = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
vi.mock('../../../lib/api.ts', () => ({
  logAdhoc: (...a: unknown[]) => logAdhoc(...a),
  getNowMenu: (...a: unknown[]) => getNowMenu(...a),
  getRoutines: (...a: unknown[]) => getRoutines(...a),
  getRoutineSession: (...a: unknown[]) => getRoutineSession(...a),
  logDid: (...a: unknown[]) => logDid(...a),
  listUserRoutines: (...a: unknown[]) => listUserRoutines(...a),
  logUserRoutineRun: (...a: unknown[]) => logUserRoutineRun(...a),
  getWorkoutHistory: (...a: unknown[]) => getWorkoutHistory(...a),
}));

// The walkthrough itself belongs to another agent's parcel — this test only needs to know
// QuickAddTense hands it the right item and reacts to its completion (or its close, for the
// routines shelf's "close without finishing" path), so a stand-in that exposes both is enough;
// the real player is exercised by its own suite.
vi.mock('../../walkthrough/Walkthrough.tsx', () => ({
  Walkthrough: ({ title, onComplete, onClose }: { title: string; onComplete: () => void; onClose: () => void }) => (
    <div>
      <div>playing: {title}</div>
      <button onClick={onComplete}>Finish</button>
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

const { QuickAddTense } = await import('./QuickAddTense.tsx');

const nowItem = (over: Record<string, unknown> = {}) => ({
  id: 'n1',
  label: 'Easy 5k',
  area: 'movement',
  action: { kind: 'tool', tool: 'timer', params: { duration_min: 20 } },
  ...over,
});

const routine = (over: Record<string, unknown> = {}) => ({
  commitment_id: 'c1',
  activity_id: 'act1',
  title: 'Easy 5k',
  area: 'movement',
  cadence: '3x/week',
  duration_min: 32,
  steps: ['Warm-up', 'Zone 2', 'Stretch'],
  finishes: 11,
  last_done: null,
  on_plan: true,
  ...over,
});

// Enough of a real OccurrenceSession for `deriveWalkthrough` (NOT mocked — only the `Walkthrough`
// component is) to project without throwing; the mocked player never looks past `title`.
const ROUTINE_SESSION = {
  blocks: [{ label: '', items: [{ name: 'Warm-up', duration_min: 5 }] }],
  note: '',
  generated_at: new Date().toISOString(),
  version: 1,
};

const userRoutine = (over: Record<string, unknown> = {}) => ({
  routine_id: 'u1',
  name: 'Hotel HIIT',
  area: 'movement',
  session: ROUTINE_SESSION,
  provenance: { kind: 'blank' },
  created_at: '',
  updated_at: '',
  runs: 6,
  last_run: null,
  schedule: null,
  ...over,
});

type MountProps = {
  area?: 'movement' | 'practice';
  noun?: string;
  toward?: string;
  onBack?: () => void;
  onLogged?: () => void;
  onSteer?: (text: string) => void;
  onBuild?: (seed?: unknown) => void;
};

function mount(props: MountProps = {}) {
  return render(
    <QuickAddTense
      area={props.area ?? 'movement'}
      noun={props.noun ?? 'A workout'}
      toward={props.toward}
      onBack={props.onBack ?? (() => {})}
      onLogged={props.onLogged ?? (() => {})}
      onSteer={props.onSteer}
      onBuild={props.onBuild as never}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('QuickAddTense', () => {
  it('composes the log text from the noun and logs it under the right area', async () => {
    const onLogged = vi.fn();
    mount({ noun: 'Piano', area: 'practice', onLogged });
    fireEvent.click(screen.getByText('30 min'));
    await waitFor(() => expect(logAdhoc).toHaveBeenCalledWith('Piano — 30 min', undefined, 'practice'));
    expect(onLogged).toHaveBeenCalled();
  });

  it('strips the fallback noun’s article before composing the log text', async () => {
    mount({ noun: 'A workout', area: 'movement' });
    fireEvent.click(screen.getByText('45 min'));
    await waitFor(() => expect(logAdhoc).toHaveBeenCalledWith('Workout — 45 min', undefined, 'movement'));
  });

  it('the custom minutes field composes the same way as a chip', async () => {
    mount({ noun: 'Piano', area: 'practice' });
    fireEvent.change(screen.getByPlaceholderText('__ min'), { target: { value: '12' } });
    fireEvent.click(screen.getByText('Log it'));
    await waitFor(() => expect(logAdhoc).toHaveBeenCalledWith('Piano — 12 min', undefined, 'practice'));
  });

  it('the free-typed line logs exactly what was typed, untouched', async () => {
    mount({ noun: 'A workout', area: 'movement' });
    fireEvent.change(screen.getByPlaceholderText(/ran 5k/), { target: { value: 'hotel gym, 30 min' } });
    fireEvent.click(screen.getByText('Log'));
    await waitFor(() => expect(logAdhoc).toHaveBeenCalledWith('hotel gym, 30 min', undefined, 'movement'));
  });

  it('"Tell me instead" hands the coach a plain seed, movement and practice phrased differently', () => {
    const onSteer = vi.fn();
    mount({ noun: 'A workout', area: 'movement', onSteer });
    fireEvent.click(screen.getByLabelText('Tell me instead'));
    expect(onSteer).toHaveBeenCalledWith('I want to log a workout');

    cleanup();
    const onSteerPractice = vi.fn();
    mount({ noun: 'Piano', area: 'practice', onSteer: onSteerPractice });
    fireEvent.click(screen.getByLabelText('Tell me instead'));
    expect(onSteerPractice).toHaveBeenCalledWith('I want to log some piano time');
  });

  it('hides "Tell me instead" when the host has no door for it', () => {
    mount({ onSteer: undefined });
    expect(screen.queryByLabelText('Tell me instead')).toBeNull();
  });

  it('scopes the now-menu to this noun’s own area — a mind or nourishment row never shows', async () => {
    getNowMenu.mockResolvedValue([
      nowItem({ id: 'a', label: 'Easy 5k', area: 'movement' }),
      nowItem({ id: 'b', label: 'Three long exhales', area: 'mind' }),
      nowItem({ id: 'c', label: 'Log a snack', area: 'nourishment' }),
      nowItem({
        id: 'd',
        label: 'Deleted-activity row',
        area: 'movement',
        action: { kind: 'activity', activityId: 'x' },
      }),
    ]);
    mount({ area: 'movement', noun: 'A workout' });
    expect(await screen.findByText('Easy 5k')).toBeTruthy();
    expect(screen.queryByText('Three long exhales')).toBeNull();
    expect(screen.queryByText('Log a snack')).toBeNull();
    // Non-tool actions (an activity row) aren't playable here — DoNowSection drops them the same way.
    expect(screen.queryByText('Deleted-activity row')).toBeNull();
  });

  it('omits "Take me on one" entirely when nothing on the menu matches — no heading, no dead row', async () => {
    getNowMenu.mockResolvedValue([nowItem({ area: 'mind' })]);
    mount({ area: 'movement', noun: 'A workout' });
    await waitFor(() => expect(getNowMenu).toHaveBeenCalled());
    expect(screen.queryByText('Take me on one')).toBeNull();
  });

  it('playing a now-menu row through to completion logs it and closes, same as the chips', async () => {
    getNowMenu.mockResolvedValue([nowItem()]);
    const onLogged = vi.fn();
    mount({ area: 'movement', noun: 'A workout', onLogged });
    fireEvent.click(await screen.findByText('Easy 5k'));
    expect(screen.getByText('playing: Easy 5k')).toBeTruthy();
    fireEvent.click(screen.getByText('Finish'));
    expect(onLogged).toHaveBeenCalled();
  });
});

/**
 * "Take me on one"'s routines half (Activity Builder 2A) — play-then-credit (useRoutinePlay.tsx),
 * "Browse all", and the two failure-honesty rules a routine row must never blur: a failed
 * `getRoutines` read must not touch the now-menu rows, and a routine with no cached session must
 * never render at all (a dead row nobody could actually play).
 */
describe('QuickAddTense — the routines shelf', () => {
  // Each test below is scoped to coach routines alone — the now-menu half already has its own
  // coverage above, and the "Yours" tier has its own describe block below. Reset to empty here
  // explicitly: `vi.clearAllMocks()` (afterEach) clears call history but NOT a `.mockResolvedValue`
  // override, so without this a prior test's rows would otherwise leak into these.
  beforeEach(() => {
    getNowMenu.mockResolvedValue([]);
    listUserRoutines.mockResolvedValue([]);
  });

  it('a routine row press fetches its session, plays it, then credits and closes on finish', async () => {
    getRoutines.mockResolvedValue([routine()]);
    getRoutineSession.mockResolvedValue({ ok: true, session: ROUTINE_SESSION });
    const onLogged = vi.fn();
    mount({ area: 'movement', noun: 'A workout', onLogged });
    fireEvent.click(await screen.findByText('Easy 5k'));
    await waitFor(() => expect(getRoutineSession).toHaveBeenCalledWith('c1'));
    expect(await screen.findByText('playing: Easy 5k')).toBeTruthy();
    fireEvent.click(screen.getByText('Finish'));
    await waitFor(() => expect(logDid).toHaveBeenCalledWith('act1'));
    expect(onLogged).toHaveBeenCalled();
  });

  it('closing a routine walkthrough without finishing returns to the shelf and logs nothing', async () => {
    getRoutines.mockResolvedValue([routine()]);
    getRoutineSession.mockResolvedValue({ ok: true, session: ROUTINE_SESSION });
    mount({ area: 'movement', noun: 'A workout' });
    fireEvent.click(await screen.findByText('Easy 5k'));
    expect(await screen.findByText('playing: Easy 5k')).toBeTruthy();
    fireEvent.click(screen.getByText('Close'));
    expect(await screen.findByText('Take me on one')).toBeTruthy();
    expect(logDid).not.toHaveBeenCalled();
  });

  it('a failed session fetch shows the row-level honest line and logs nothing — never "no session"', async () => {
    getRoutines.mockResolvedValue([routine()]);
    getRoutineSession.mockResolvedValue({ ok: false, session: null });
    mount({ area: 'movement', noun: 'A workout' });
    fireEvent.click(await screen.findByText('Easy 5k'));
    expect(await screen.findByText("Couldn't open that one just now — try again in a moment.")).toBeTruthy();
    expect(screen.queryByText(/playing:/)).toBeNull();
    expect(logDid).not.toHaveBeenCalled();
  });

  it('a vanished cached session (ok, but session: null) gets a plainer line — not the fetch-failure one', async () => {
    getRoutines.mockResolvedValue([routine()]);
    getRoutineSession.mockResolvedValue({ ok: true, session: null });
    mount({ area: 'movement', noun: 'A workout' });
    fireEvent.click(await screen.findByText('Easy 5k'));
    expect(await screen.findByText('Nothing to play there right now — try again in a moment.')).toBeTruthy();
    expect(screen.queryByText(/playing:/)).toBeNull();
  });

  it('"Browse all N" swaps the section for the full playable-routines list, and back returns', async () => {
    getRoutines.mockResolvedValue([
      routine({ commitment_id: 'c1', title: 'Easy 5k', finishes: 11 }),
      routine({ commitment_id: 'c2', title: 'Hill repeats', finishes: 6 }),
      routine({ commitment_id: 'c3', title: 'Long run', finishes: 2 }),
    ]);
    mount({ area: 'movement', noun: 'A workout' });
    expect(await screen.findByText('Easy 5k')).toBeTruthy();
    expect(screen.getByText('Hill repeats')).toBeTruthy();
    // The API's own finishes order is a SLICE, never a re-sort — the third routine is real but
    // doesn't fit the top-2 shelf, so it's the one "Browse all" exists to reach.
    expect(screen.queryByText('Long run')).toBeNull();

    fireEvent.click(screen.getByText('Browse all 3 ›'));
    expect(screen.getByText('Long run')).toBeTruthy();
    expect(screen.getByText('Easy 5k')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Back to Take me on one'));
    expect(screen.queryByText('Long run')).toBeNull();
    expect(screen.getByText('Easy 5k')).toBeTruthy();
  });

  it('a failed routines read (getRoutines → null) never removes the now-menu rows', async () => {
    getNowMenu.mockResolvedValue([nowItem({ label: 'Easy 5k' })]);
    getRoutines.mockResolvedValue(null);
    mount({ area: 'movement', noun: 'A workout' });
    expect(await screen.findByText('Easy 5k')).toBeTruthy();
    expect(screen.getByText('Take me on one')).toBeTruthy();
  });

  it("a routine with no cached session (steps: []) never renders — a dead row can't play", async () => {
    getRoutines.mockResolvedValue([routine({ commitment_id: 'c2', title: 'Ghost routine', steps: [] })]);
    mount({ area: 'movement', noun: 'A workout' });
    await waitFor(() => expect(getRoutines).toHaveBeenCalled());
    expect(screen.queryByText('Ghost routine')).toBeNull();
    expect(screen.queryByText('Take me on one')).toBeNull();
  });

  it('an empty routines list ([]) is a real answer — the section still shows the now-menu items alone', async () => {
    getNowMenu.mockResolvedValue([nowItem({ label: 'Easy 5k' })]);
    getRoutines.mockResolvedValue([]);
    mount({ area: 'movement', noun: 'A workout' });
    expect(await screen.findByText('Easy 5k')).toBeTruthy();
    expect(screen.queryByText(/Browse all/)).toBeNull();
  });
});

/**
 * "Take me on one"'s THIRD tier — the user's own built routines (Activity Builder wave 3),
 * wearing a quiet "yours" chip, listed after now-menu items AND coach routines but sharing the
 * same 5-row cap and Browse-all. Playing one needs no fetch: the session is already in hand.
 */
describe('QuickAddTense — the "Yours" tier', () => {
  beforeEach(() => {
    getNowMenu.mockResolvedValue([]);
    getRoutines.mockResolvedValue([]);
  });

  it('a Yours row plays straight from the session in hand — no getRoutineSession fetch at all', async () => {
    listUserRoutines.mockResolvedValue([userRoutine()]);
    mount({ area: 'movement', noun: 'A workout' });
    fireEvent.click(await screen.findByText('Hotel HIIT'));
    expect(getRoutineSession).not.toHaveBeenCalled();
    expect(screen.getByText('playing: Hotel HIIT')).toBeTruthy();
  });

  it('completing a Yours walkthrough credits logUserRoutineRun with its id, then onLogged', async () => {
    listUserRoutines.mockResolvedValue([userRoutine({ routine_id: 'u9' })]);
    const onLogged = vi.fn();
    mount({ area: 'movement', noun: 'A workout', onLogged });
    fireEvent.click(await screen.findByText('Hotel HIIT'));
    fireEvent.click(screen.getByText('Finish'));
    await waitFor(() => expect(logUserRoutineRun).toHaveBeenCalledWith('u9'));
    expect(onLogged).toHaveBeenCalled();
  });

  it('closing a Yours walkthrough without finishing returns to the shelf and logs nothing', async () => {
    listUserRoutines.mockResolvedValue([userRoutine()]);
    mount({ area: 'movement', noun: 'A workout' });
    fireEvent.click(await screen.findByText('Hotel HIIT'));
    fireEvent.click(screen.getByText('Close'));
    expect(await screen.findByText('Take me on one')).toBeTruthy();
    expect(logUserRoutineRun).not.toHaveBeenCalled();
  });

  it('a routine for a different area never shows — listUserRoutines carries every area, filtered here', async () => {
    listUserRoutines.mockResolvedValue([userRoutine({ name: 'Piano scales', area: 'practice' })]);
    mount({ area: 'movement', noun: 'A workout' });
    await waitFor(() => expect(listUserRoutines).toHaveBeenCalled());
    expect(screen.queryByText('Piano scales')).toBeNull();
  });

  it('a routine with no steps never renders, same "no dead row" rule as a coach routine', async () => {
    listUserRoutines.mockResolvedValue([
      userRoutine({ name: 'Empty shell', session: { blocks: [], note: '', generated_at: '', version: 1 } }),
    ]);
    mount({ area: 'movement', noun: 'A workout' });
    await waitFor(() => expect(listUserRoutines).toHaveBeenCalled());
    expect(screen.queryByText('Empty shell')).toBeNull();
    expect(screen.queryByText('Take me on one')).toBeNull();
  });

  it('a failed Yours read (null) never removes the now-menu or coach-routine rows', async () => {
    getNowMenu.mockResolvedValue([nowItem({ label: 'Easy 5k' })]);
    listUserRoutines.mockResolvedValue(null);
    mount({ area: 'movement', noun: 'A workout' });
    expect(await screen.findByText('Easy 5k')).toBeTruthy();
  });

  it('now-menu, then coach routines, then Yours — in that order, sharing the one 5-row cap', async () => {
    getNowMenu.mockResolvedValue([
      nowItem({ id: 'n1', label: 'Now 1' }),
      nowItem({ id: 'n2', label: 'Now 2' }),
      nowItem({ id: 'n3', label: 'Now 3' }),
    ]);
    getRoutines.mockResolvedValue([
      routine({ commitment_id: 'c1', title: 'Coach 1' }),
      routine({ commitment_id: 'c2', title: 'Coach 2' }),
    ]);
    listUserRoutines.mockResolvedValue([userRoutine({ routine_id: 'u1', name: 'Yours 1' })]);
    mount({ area: 'movement', noun: 'A workout' });
    // 3 now-menu rows leave 2 slots; both go to coach routines (listed first), so no room is left
    // for the one "Yours" row — it's real, but only "Browse all" reaches it.
    expect(await screen.findByText('Coach 1')).toBeTruthy();
    expect(screen.getByText('Coach 2')).toBeTruthy();
    expect(screen.queryByText('Yours 1')).toBeNull();
    expect(screen.getByText('Browse all 3 ›')).toBeTruthy();

    fireEvent.click(screen.getByText('Browse all 3 ›'));
    expect(screen.getByText('Yours 1')).toBeTruthy();
  });
});

/**
 * "Build my own" — the screen's last door, into `StartFromScreen`'s three shelves. Hidden without
 * `onBuild` (no door without a house, same rule `onSteer` follows); a pick there bubbles straight
 * up to the `onBuild` this screen was given.
 */
describe('QuickAddTense — Build my own', () => {
  beforeEach(() => {
    getNowMenu.mockResolvedValue([]);
    getRoutines.mockResolvedValue([]);
    listUserRoutines.mockResolvedValue([]);
  });

  it('is hidden entirely without a house to open it into', () => {
    mount({ onBuild: undefined });
    expect(screen.queryByLabelText('Build my own')).toBeNull();
  });

  it('opens the Start-from screen, scoped to this noun’s own playable routines', async () => {
    getRoutines.mockResolvedValue([routine({ commitment_id: 'c1', title: 'Easy 5k' })]);
    listUserRoutines.mockResolvedValue([userRoutine({ routine_id: 'u1', name: 'Hotel HIIT' })]);
    mount({ area: 'movement', noun: 'A workout', onBuild: vi.fn() });
    fireEvent.click(await screen.findByLabelText('Build my own'));
    expect(screen.getByText('Start from')).toBeTruthy();
    expect(screen.getByText('From Cadence')).toBeTruthy();
    expect(screen.getByText('Easy 5k')).toBeTruthy();
    expect(screen.getByText('Yours')).toBeTruthy();
    expect(screen.getByText('Hotel HIIT')).toBeTruthy();
    expect(screen.getByText('Blank')).toBeTruthy();
  });

  it('a Start-from back tap returns to the tense screen', async () => {
    mount({ area: 'movement', noun: 'A workout', onBuild: vi.fn() });
    fireEvent.click(await screen.findByLabelText('Build my own'));
    expect(screen.getByText('Start from')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Back'));
    expect(await screen.findByLabelText('Build my own')).toBeTruthy();
  });

  it('picking Blank hands the host onBuild(undefined), and the screen returns to the shelf', async () => {
    const onBuild = vi.fn();
    mount({ area: 'movement', noun: 'A workout', onBuild });
    fireEvent.click(await screen.findByLabelText('Build my own'));
    fireEvent.click(screen.getByText('Blank'));
    expect(onBuild).toHaveBeenCalledWith(undefined);
    expect(await screen.findByLabelText('Build my own')).toBeTruthy();
  });
});

/**
 * "Pull from Apple Health" — the log door's fastest source (design 2A screen 2). No device work:
 * the phone already syncs into workout_history, read via `getWorkoutHistory`. Movement-only; the
 * filter itself (device source, today, type-matched) is healthPull.test.ts's job — these pin the
 * WIRING: the exact composed text reaching `logAdhoc`, the shared busy/note guard, and the one
 * quirk this read alone has — it THROWS on failure instead of resolving `ok: false`.
 */
describe('QuickAddTense — Pull from Apple Health', () => {
  const YESTERDAY = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const workout = (over: Record<string, unknown> = {}) => ({
    source: 'healthkit',
    type: 'run',
    startedAt: new Date().toISOString(), // "now" is always today, wherever/whenever this runs
    durationMin: 32,
    distanceKm: 4.8,
    avgHr: null,
    ...over,
  });

  beforeEach(() => {
    getNowMenu.mockResolvedValue([]);
    getRoutines.mockResolvedValue([]);
    listUserRoutines.mockResolvedValue([]);
    getWorkoutHistory.mockResolvedValue([]);
  });

  it('a row press composes the exact text, logs under the area, then closes', async () => {
    getWorkoutHistory.mockResolvedValue([workout()]);
    const onLogged = vi.fn();
    mount({ area: 'movement', noun: 'A run', onLogged });
    fireEvent.click(await screen.findByLabelText('Pull from Apple Health'));
    await waitFor(() =>
      expect(logAdhoc).toHaveBeenCalledWith('Run — 4.8 km · 32 min (from Apple Health)', undefined, 'movement'),
    );
    expect(onLogged).toHaveBeenCalled();
  });

  it('omits an absent fact cleanly — no distance recorded means no invented number', async () => {
    getWorkoutHistory.mockResolvedValue([workout({ distanceKm: null })]);
    mount({ area: 'movement', noun: 'A run' });
    fireEvent.click(await screen.findByLabelText('Pull from Apple Health'));
    await waitFor(() =>
      expect(logAdhoc).toHaveBeenCalledWith('Run — 32 min (from Apple Health)', undefined, 'movement'),
    );
  });

  it('a strava row wears "Pull from Strava" — never the wrong brand', async () => {
    getWorkoutHistory.mockResolvedValue([workout({ source: 'strava' })]);
    mount({ area: 'movement', noun: 'A run' });
    expect(await screen.findByLabelText('Pull from Strava')).toBeTruthy();
    expect(screen.queryByLabelText('Pull from Apple Health')).toBeNull();
    fireEvent.click(screen.getByLabelText('Pull from Strava'));
    await waitFor(() =>
      expect(logAdhoc).toHaveBeenCalledWith('Run — 4.8 km · 32 min (from Strava)', undefined, 'movement'),
    );
  });

  it("a cadence-sourced row never renders — that's a session already logged here", async () => {
    getWorkoutHistory.mockResolvedValue([workout({ source: 'cadence' })]);
    mount({ area: 'movement', noun: 'A run' });
    await waitFor(() => expect(getWorkoutHistory).toHaveBeenCalled());
    expect(screen.queryByLabelText(/Pull from/)).toBeNull();
  });

  it("yesterday's workout never renders", async () => {
    getWorkoutHistory.mockResolvedValue([workout({ startedAt: YESTERDAY })]);
    mount({ area: 'movement', noun: 'A run' });
    await waitFor(() => expect(getWorkoutHistory).toHaveBeenCalled());
    expect(screen.queryByLabelText(/Pull from/)).toBeNull();
  });

  it('a wrong-type workout never renders under a specific noun, but does under "A workout"', async () => {
    getWorkoutHistory.mockResolvedValue([workout({ type: 'ride' })]);
    mount({ area: 'movement', noun: 'A run' });
    await waitFor(() => expect(getWorkoutHistory).toHaveBeenCalled());
    expect(screen.queryByLabelText(/Pull from/)).toBeNull();

    cleanup();
    getWorkoutHistory.mockResolvedValue([workout({ type: 'ride' })]);
    mount({ area: 'movement', noun: 'A workout' });
    expect(await screen.findByLabelText('Pull from Apple Health')).toBeTruthy();
  });

  it('a fetch that throws leaves no rows and everything else intact', async () => {
    getWorkoutHistory.mockRejectedValue(new Error('boom'));
    mount({ area: 'movement', noun: 'A run' });
    await waitFor(() => expect(getWorkoutHistory).toHaveBeenCalled());
    expect(screen.queryByLabelText(/Pull from/)).toBeNull();
    // The rest of the screen is untouched by the throw.
    expect(screen.getByText('30 min')).toBeTruthy();
  });

  it('ok: false shows the same honest note the chips show', async () => {
    getWorkoutHistory.mockResolvedValue([workout()]);
    logAdhoc.mockResolvedValue({ ok: false });
    mount({ area: 'movement', noun: 'A run' });
    fireEvent.click(await screen.findByLabelText('Pull from Apple Health'));
    expect(await screen.findByText("That didn't save — try again in a moment.")).toBeTruthy();
  });

  it('the shared busy guard blocks a second press while the first is still in flight', async () => {
    getWorkoutHistory.mockResolvedValue([workout()]);
    let resolveLog!: (v: { ok: boolean }) => void;
    logAdhoc.mockReturnValue(
      new Promise((resolve) => {
        resolveLog = resolve;
      }),
    );
    mount({ area: 'movement', noun: 'A run' });
    const row = await screen.findByLabelText('Pull from Apple Health');
    fireEvent.click(row);
    expect(row).toBeDisabled(); // busy — the row itself goes inert, same as every other tap here
    fireEvent.click(row); // still in flight — must not fire a second call
    expect(logAdhoc).toHaveBeenCalledTimes(1);
    resolveLog({ ok: true }); // let the pending write settle so nothing dangles past the test
    await waitFor(() => expect(logAdhoc).toHaveBeenCalledTimes(1));
  });

  it('a practice noun never calls getWorkoutHistory — no device data to offer a piano practice', async () => {
    mount({ area: 'practice', noun: 'Piano' });
    await waitFor(() => expect(getNowMenu).toHaveBeenCalled());
    expect(getWorkoutHistory).not.toHaveBeenCalled();
  });
});
