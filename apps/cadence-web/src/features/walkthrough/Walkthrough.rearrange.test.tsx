/**
 * Rearrange through the shell (walkthrough v3 Phase 6): All steps → Rearrange → Combine → Done
 * makes the pair play as one step that logs each turn; the Recap lists the change with Every
 * time / Just today and reads the group as "circuit · 3 rounds" with each move's numbers behind
 * it; Finish writes nothing to how_to by itself; a relaunch keeps the shape and the turns logged;
 * a spread set plays as its own step in its new place; and rearranging itself logs nothing.
 */
import { screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Walkthrough as WalkthroughData } from '@cadence/shared';
import { renderWithQuery } from '../../test/withQuery.tsx';
import { Walkthrough } from './Walkthrough.tsx';
import { readSessionInProgress } from './sessionInProgress.ts';

const keepHowTo = vi.fn();
vi.mock('../../lib/api.ts', () => ({
  getUnits: async () => ({ prefs: null, resolved: { body_weight: 'lb' } }),
  getExerciseHistory: async () => ({ ok: true, lines: [] }),
  askAlternativeItem: async () => ({ ok: false, reason: 'unreachable' }),
  keepJournalEntry: async () => undefined,
  settleTempo: async () => undefined,
  keepHowTo: (...a: unknown[]) => keepHowTo(...a),
}));
vi.mock('../../lib/persisted-session.ts', () => ({ readPersistedSession: () => ({ user: { id: 'u1' } }) }));
vi.mock('../../lib/api/http.ts', () => ({
  isDevMode: () => false,
  getDevAccount: () => 'account-1',
  BASE: '/api',
  headers: () => ({}),
  timeoutSignal: () => undefined,
}));
vi.mock('./tools/chime.ts', () => ({ playChime: vi.fn(), playTones: vi.fn(), unlockAudio: vi.fn(), CHIME_SWITCH: [] }));

const wt: WalkthroughData = {
  total_min: 24,
  steps: [
    { id: 's1', title: 'Pull-ups', minutes: 6, tool: { kind: 'reps', sets: 2, reps: 5 }, skippable: true },
    {
      id: 's2',
      title: 'Bench press',
      minutes: 6,
      tool: { kind: 'reps', sets: 2, reps: 8, load: '95 lb' },
      skippable: true,
    },
    {
      id: 's3',
      title: 'Dumbbell row',
      minutes: 6,
      tool: { kind: 'reps', sets: 2, reps: 10, load: '40 lb' },
      skippable: true,
    },
    { id: 's4', title: 'Dead hang', minutes: 6, tool: { kind: 'timer', seconds: 45, sets: 2 }, skippable: true },
  ],
};

const press = (label: string | RegExp) => fireEvent.click(screen.getByRole('button', { name: label }));
const pick = (title: string) => fireEvent.click(screen.getByRole('checkbox', { name: `Pick ${title}` }));
const mount = (extra: Partial<Parameters<typeof Walkthrough>[0]> = {}) => {
  const onComplete = vi.fn();
  renderWithQuery(
    <Walkthrough
      walkthrough={wt}
      title="Obstacle strength"
      occurrenceId="o1"
      onClose={() => {}}
      onComplete={onComplete}
      {...extra}
    />,
  );
  return { onComplete };
};
/** All steps → Rearrange → pick the presses and the rows → Combine → Done. */
function alternatePressesAndRows() {
  press('All steps');
  press('Rearrange');
  pick('Bench press');
  pick('Dumbbell row');
  press('Combine');
  press('Done');
}

beforeEach(() => {
  localStorage.clear();
  keepHowTo.mockReset();
  keepHowTo.mockResolvedValue({
    ok: true,
    kept: true,
    how_to: 'alternate bench press and dumbbell row',
    activity: 'Obstacle strength',
  });
});
afterEach(cleanup);

describe('Rearrange — through the shell', () => {
  it('Combine makes the pair one step; rearranging logs nothing; the pips count the new steps', () => {
    mount();
    press('Next step');
    alternatePressesAndRows();
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    expect(screen.getByText('Circuit · Round 1 of 2 · bench + row')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Skip circuit/ })).toBeInTheDocument();
    const snap = readSessionInProgress();
    expect(snap?.logs).toEqual({});
    expect(snap?.turnLogs).toEqual({});
    expect(snap?.shape?.map((g) => g.turns.length)).toEqual([2, 4, 2]);
  });

  it('the pair logs each turn; the Recap reads the group once with each move’s numbers, and Finish carries them', () => {
    const { onComplete } = mount();
    press('Next step');
    alternatePressesAndRows();
    for (let i = 0; i < 4; i++) press('Log'); // bench R1, row R1, bench R2, row R2
    expect(screen.getByRole('button', { name: 'Row R2' })).toHaveAttribute('aria-current', 'step');
    press('All steps');
    press('Review & finish ›');
    expect(screen.getByText('You changed 1 thing')).toBeInTheDocument();
    expect(screen.getByText('Bench press + dumbbell row, alternating')).toBeInTheDocument();
    expect(screen.getByText('Bench + row')).toBeInTheDocument();
    expect(screen.getByText('circuit · 2 rounds')).toBeInTheDocument();
    expect(screen.queryByText(/skipped|passed over.*(bench|row)/i)).toBeNull();
    press('Finish · +10 XP');
    press('Done');
    expect(onComplete).toHaveBeenCalledWith(
      expect.stringContaining('bench + row circuit · 2 rounds (bench press 2×8 @ 95 lb, dumbbell row 2×10 @ 40 lb)'),
    );
    // Finish never writes how_to by itself.
    expect(keepHowTo).not.toHaveBeenCalled();
  });

  it('Every time writes once from the Recap; Just today writes nothing', async () => {
    mount();
    press('Next step');
    alternatePressesAndRows();
    press('All steps');
    press('Review & finish ›');
    press('Every time');
    await waitFor(() =>
      expect(screen.getByText('Every time · alternate bench press and dumbbell row')).toBeInTheDocument(),
    );
    expect(keepHowTo).toHaveBeenCalledTimes(1);
    expect(keepHowTo).toHaveBeenCalledWith('o1', 'alternate bench press and dumbbell row');
    expect(screen.queryByRole('button', { name: 'Every time' })).toBeNull();
  });

  it('a relaunch keeps the shape and the turns already logged', () => {
    mount();
    press('Next step');
    alternatePressesAndRows();
    press('Log');
    press('Log');
    const snap = readSessionInProgress();
    cleanup();
    expect(snap?.turnLogs).toEqual({ 's2:0': { value: 8, load: '95 lb' }, 's3:0': { value: 10, load: '40 lb' } });
    mount({ resume: snap });
    expect(screen.getByText('Circuit · Round 2 of 2 · bench + row')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bench R2' })).toHaveAttribute('aria-current', 'step');
  });

  it('a set dragged out plays as its own step where it was put; Split in All steps takes a pair apart', () => {
    mount();
    alternatePressesAndRows();
    press('All steps');
    press('Split');
    const sheet = within(screen.getByRole('dialog', { name: 'All steps' }));
    expect(sheet.getByText('Bench press')).toBeInTheDocument();
    expect(sheet.getByText('Dumbbell row')).toBeInTheDocument();
    expect(sheet.queryByText('Bench press + dumbbell row')).toBeNull();
  });

  it('Change on a turn opens the sheet for that move', () => {
    mount();
    press('Next step');
    alternatePressesAndRows();
    press('Change');
    expect(screen.getByRole('dialog', { name: 'Change this move' })).toBeInTheDocument();
    expect(screen.getByText(/BENCH PRESS/)).toBeInTheDocument();
  });
});
