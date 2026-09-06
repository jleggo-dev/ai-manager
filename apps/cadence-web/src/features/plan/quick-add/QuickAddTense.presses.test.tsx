/**
 * Press-level hardening for screen 2 ("the tense") beyond what QuickAddTense.test.tsx already
 * pins: the Enter-key paths (both fields have an onKeyDown twin of their click handler), the honest
 * failure of a logAdhoc call that resolves `{ ok: false }` (never a rejection — the sheet's own
 * contract is to keep the step and show a note, not silently drop the attempt), and the back
 * affordance's own callback.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from '../../../test/withQuery.tsx';

const logAdhoc = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
const getNowMenu = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
vi.mock('../../../lib/api.ts', () => ({
  logAdhoc: (...a: unknown[]) => logAdhoc(...a),
  getNowMenu: (...a: unknown[]) => getNowMenu(...a),
  // Wave 2 (routines shelf) landed under this sweep: the tense screen reads routines too.
  getRoutines: async () => [],
  getRoutineSession: async () => ({ ok: true, session: null }),
  logDid: async () => ({ ok: true }),
  // Wave 3 (Build my own): the tense screen also reads the user's own routines on mount.
  listUserRoutines: async () => [],
  logUserRoutineRun: async () => ({ ok: true }),
  // The Apple Health pull: the tense screen also reads today's synced workouts on mount, for a
  // movement noun. Empty by default; it THROWS on a real failure, unlike everything else here.
  getWorkoutHistory: async () => [],
}));

vi.mock('../../walkthrough/Walkthrough.tsx', () => ({
  Walkthrough: ({ title, onComplete }: { title: string; onComplete: () => void }) => (
    <div>
      <div>playing: {title}</div>
      <button onClick={onComplete}>Finish</button>
    </div>
  ),
}));

const { QuickAddTense } = await import('./QuickAddTense.tsx');

type MountProps = {
  area?: 'movement' | 'practice';
  noun?: string;
  onBack?: () => void;
  onLogged?: () => void;
};

function mount(props: MountProps = {}) {
  return renderWithQuery(
    <QuickAddTense
      area={props.area ?? 'movement'}
      noun={props.noun ?? 'A workout'}
      onBack={props.onBack ?? (() => {})}
      onLogged={props.onLogged ?? (() => {})}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('QuickAddTense — Enter as a click twin', () => {
  it('Enter in the custom minutes field composes and logs the same as clicking "Log it"', async () => {
    mount({ noun: 'Piano', area: 'practice' });
    fireEvent.change(screen.getByPlaceholderText('__ min'), { target: { value: '18' } });
    fireEvent.keyDown(screen.getByPlaceholderText('__ min'), { key: 'Enter' });
    await waitFor(() => expect(logAdhoc).toHaveBeenCalledWith('Piano — 18 min', undefined, 'practice'));
  });

  it('Enter in the free-typed line logs exactly what was typed, same as clicking "Log"', async () => {
    mount({ noun: 'A workout', area: 'movement' });
    fireEvent.change(screen.getByPlaceholderText(/ran 5k/), { target: { value: 'stairs, 4 flights' } });
    fireEvent.keyDown(screen.getByPlaceholderText(/ran 5k/), { key: 'Enter' });
    await waitFor(() => expect(logAdhoc).toHaveBeenCalledWith('stairs, 4 flights', undefined, 'movement'));
  });
});

describe('QuickAddTense — the back affordance', () => {
  it('the back button calls onBack', () => {
    const onBack = vi.fn();
    mount({ onBack });
    fireEvent.click(screen.getByLabelText('Back'));
    expect(onBack).toHaveBeenCalled();
  });
});

describe('QuickAddTense — honest failure keeps the step and shows a note', () => {
  it('a duration chip whose log fails never tells the host it logged', async () => {
    logAdhoc.mockResolvedValueOnce({ ok: false });
    const onLogged = vi.fn();
    mount({ noun: 'A workout', area: 'movement', onLogged });
    fireEvent.click(screen.getByText('30 min'));
    await waitFor(() => expect(logAdhoc).toHaveBeenCalledWith('Workout — 30 min', undefined, 'movement'));
    expect(onLogged).not.toHaveBeenCalled();
    expect(await screen.findByText("That didn't save — try again in a moment.")).toBeTruthy();
  });

  it('a failed free-typed log never tells the host it logged, and the typed text survives to retry', async () => {
    logAdhoc.mockResolvedValueOnce({ ok: false });
    const onLogged = vi.fn();
    mount({ noun: 'A workout', area: 'movement', onLogged });
    fireEvent.change(screen.getByPlaceholderText(/ran 5k/), { target: { value: 'hotel gym, 30 min' } });
    fireEvent.click(screen.getByText('Log'));
    await waitFor(() => expect(logAdhoc).toHaveBeenCalledWith('hotel gym, 30 min', undefined, 'movement'));
    expect(onLogged).not.toHaveBeenCalled();
    expect(await screen.findByText("That didn't save — try again in a moment.")).toBeTruthy();
    // The line isn't cleared out from under someone who's about to retry.
    expect(screen.getByPlaceholderText(/ran 5k/)).toHaveValue('hotel gym, 30 min');
  });
});
