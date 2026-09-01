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
vi.mock('../../../lib/api.ts', () => ({
  logAdhoc: (...a: unknown[]) => logAdhoc(...a),
  getNowMenu: (...a: unknown[]) => getNowMenu(...a),
  getRoutines: (...a: unknown[]) => getRoutines(...a),
  getRoutineSession: (...a: unknown[]) => getRoutineSession(...a),
  logDid: (...a: unknown[]) => logDid(...a),
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

type MountProps = {
  area?: 'movement' | 'practice';
  noun?: string;
  toward?: string;
  onBack?: () => void;
  onLogged?: () => void;
  onSteer?: (text: string) => void;
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
  // Each test below is scoped to routines alone — the now-menu half already has its own coverage
  // above, so it's reset to empty here explicitly. `vi.clearAllMocks()` (afterEach) clears call
  // history but NOT a `.mockResolvedValue` override, so without this a prior test's now-menu rows
  // would otherwise leak into these.
  beforeEach(() => {
    getNowMenu.mockResolvedValue([]);
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
