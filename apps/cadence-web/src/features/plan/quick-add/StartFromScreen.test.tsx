/**
 * "Build my own" → Start from (Activity Builder wave 3) — every shelf pick's exact hand-off to
 * the builder, pinned so a caller (QuickAddTense today, the Settings "＋ New activity" row later)
 * can trust the payload without re-deriving it. Follows QuickAddTense.test.tsx's mocking idiom.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const getRoutineSession = vi.fn(async (..._a: unknown[]) => ({ ok: true, session: null }) as unknown);
vi.mock('../../../lib/api.ts', () => ({
  getRoutineSession: (...a: unknown[]) => getRoutineSession(...a),
}));

const { StartFromScreen } = await import('./StartFromScreen.tsx');

const coachRoutine = (over: Record<string, unknown> = {}) => ({
  commitment_id: 'c1',
  activity_id: 'act1',
  title: 'Easy 5k',
  area: 'movement',
  duration_min: 32,
  steps: ['Warm-up', 'Zone 2', 'Stretch'],
  finishes: 11,
  last_done: null,
  on_plan: true,
  ...over,
});

const userRoutine = (over: Record<string, unknown> = {}) => ({
  routine_id: 'u1',
  name: 'Hill repeats',
  area: 'movement',
  session: {
    blocks: [{ label: '', items: [{ name: 'Hills', duration_min: 22 }] }],
    note: '',
    generated_at: '',
    version: 1,
  },
  provenance: { kind: 'blank' },
  created_at: '',
  updated_at: '',
  runs: 3,
  last_run: null,
  schedule: null,
  ...over,
});

const SESSION = {
  blocks: [{ label: '', items: [{ name: 'Warm-up', duration_min: 5 }] }],
  note: '',
  generated_at: '',
  version: 1,
};

function mount(
  props: { coachRoutines?: unknown[]; userRoutines?: unknown[]; onBuild?: (seed?: unknown) => void } = {},
) {
  return render(
    <StartFromScreen
      area="movement"
      coachRoutines={(props.coachRoutines ?? []) as never}
      userRoutines={(props.userRoutines ?? []) as never}
      onBack={() => {}}
      onBuild={props.onBuild ?? (() => {})}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('StartFromScreen', () => {
  it('empty shelves are simply absent — no "From the coach" or "Yours" heading over nothing', () => {
    mount();
    expect(screen.queryByText('From the coach')).toBeNull();
    expect(screen.queryByText('Yours')).toBeNull();
    // Blank is always there — you can always start from nothing.
    expect(screen.getByText('Blank')).toBeTruthy();
  });

  it('a From the coach pick fetches the session, then hands onBuild the exact seed', async () => {
    getRoutineSession.mockResolvedValue({ ok: true, session: SESSION });
    const onBuild = vi.fn();
    mount({ coachRoutines: [coachRoutine()], onBuild });
    fireEvent.click(screen.getByText('Easy 5k'));
    await waitFor(() => expect(getRoutineSession).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(onBuild).toHaveBeenCalled());
    expect(onBuild).toHaveBeenCalledWith({
      name: 'Easy 5k — mine',
      session: SESSION,
      provenance: { kind: 'from_cadence', source_commitment_id: 'c1' },
      area: 'movement',
    });
  });

  it('a failed From the coach session fetch shows the row-level honest line and never calls onBuild', async () => {
    getRoutineSession.mockResolvedValue({ ok: false, session: null });
    const onBuild = vi.fn();
    mount({ coachRoutines: [coachRoutine()], onBuild });
    fireEvent.click(screen.getByText('Easy 5k'));
    expect(await screen.findByText("Couldn't open that one just now — try again in a moment.")).toBeTruthy();
    expect(onBuild).not.toHaveBeenCalled();
  });

  it('a vanished cached session shows the plainer honest line, not the fetch-failure one', async () => {
    getRoutineSession.mockResolvedValue({ ok: true, session: null });
    mount({ coachRoutines: [coachRoutine()] });
    fireEvent.click(screen.getByText('Easy 5k'));
    expect(await screen.findByText('Nothing to play there right now — try again in a moment.')).toBeTruthy();
  });

  it('a Yours pick needs no fetch — onBuild fires with the exact seed, name numbered, runs implicitly zero', () => {
    const onBuild = vi.fn();
    mount({ userRoutines: [userRoutine()], onBuild });
    fireEvent.click(screen.getByText('Hill repeats'));
    expect(getRoutineSession).not.toHaveBeenCalled();
    expect(onBuild).toHaveBeenCalledWith({
      name: 'Hill repeats 2',
      session: userRoutine().session,
      provenance: { kind: 'blank' },
      area: 'movement',
    });
  });

  it('Blank hands onBuild nothing at all — the builder opens on its own type-first screen', () => {
    const onBuild = vi.fn();
    mount({ onBuild });
    fireEvent.click(screen.getByText('Blank'));
    expect(onBuild).toHaveBeenCalledWith(undefined);
  });
});
