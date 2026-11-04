/**
 * "Change this move" through the shell (walkthrough v3 Phase 5): Change opens the one sheet; a swap
 * replaces the step's tool and shows the pill; Undo restores; a weight is written to the set in hand
 * only and the chips carry each set's load; a swap reads as a swap in All steps, the Recap and the
 * summary the coach gets; and all of it is remembered on disk so a relaunch keeps it.
 */
import { screen, fireEvent, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Walkthrough as WalkthroughData } from '@cadence/shared';
import { renderWithQuery } from '../../test/withQuery.tsx';
import { Walkthrough } from './Walkthrough.tsx';
import { readSessionInProgress } from './sessionInProgress.ts';

vi.mock('../../lib/api.ts', () => ({
  getUnits: async () => ({ prefs: null, resolved: { body_weight: 'lb' } }),
  getExerciseHistory: async () => ({ ok: true, lines: [] }),
  askAlternativeItem: async () => ({ ok: false, reason: 'unreachable' }),
  keepJournalEntry: async () => undefined,
  settleTempo: async () => undefined,
}));
vi.mock('../../lib/persisted-session.ts', () => ({ readPersistedSession: () => ({ user: { id: 'u1' } }) }));
vi.mock('../../lib/api/http.ts', () => ({
  isDevMode: () => false,
  getDevAccount: () => 'account-1',
  BASE: '/api',
  headers: () => ({}),
  timeoutSignal: () => undefined,
}));

const wt: WalkthroughData = {
  total_min: 8,
  steps: [
    {
      id: 's1',
      title: 'Glute bridge',
      body: 'Squeeze at the top.',
      video_query: 'glute bridge form',
      minutes: 3,
      skippable: true,
      tool: { kind: 'reps', sets: 2, reps: 12, load: 'bodyweight' },
      suggested_load: '15 lb',
      alternatives: [
        {
          name: 'Kettlebell hip thrust',
          sets: 2,
          reps: 12,
          load: '40 lb',
          detail: 'Shoulders on the bench.',
          equipment: ['Bench', 'kettlebell'],
        },
      ],
    },
    { id: 's2', title: 'Walk it off', minutes: 5, tool: { kind: 'read' }, skippable: true },
  ],
};

const press = (label: string | RegExp) => fireEvent.click(screen.getByRole('button', { name: label }));
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

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('Change this move — through the shell', () => {
  it('Change opens the sheet for this move; Close puts it away', () => {
    mount();
    press('Change');
    expect(screen.getByRole('dialog', { name: 'Change this move' })).toBeInTheDocument();
    expect(screen.getByText('GLUTE BRIDGE · SET 1 OF 2 NEXT')).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Change this move' })).getByRole('button', { name: 'Close' }),
    );
    expect(screen.queryByRole('dialog', { name: 'Change this move' })).toBeNull();
  });

  it('a swap plays the alternative — name, target, cue — with the pill; Undo brings the prescribed move back', () => {
    mount();
    press('Change');
    press(/^Kettlebell hip thrust/);
    expect(screen.getByText('Kettlebell hip thrust')).toBeInTheDocument();
    expect(screen.getByText('12 × 40 lb · 2 sets')).toBeInTheDocument();
    expect(screen.getByText('Shoulders on the bench.')).toBeInTheDocument();
    expect(screen.getByText('Swapped from Glute bridge')).toBeInTheDocument();
    expect(screen.getByText('reps · 40 lb')).toBeInTheDocument();
    press('Undo');
    expect(screen.queryByText('Swapped from Glute bridge')).toBeNull();
    expect(screen.getByText('Glute bridge')).toBeInTheDocument();
    expect(screen.getByText('12 × bodyweight · 2 sets')).toBeInTheDocument();
  });

  it('a weight goes on the set in hand only: logged sets keep theirs, the chips carry each, the target and dial say it', () => {
    mount();
    press('Change');
    press(/Add weight/);
    press('Use 15 lb'); // the dial opened on her suggestion
    expect(screen.getByText('12 × 15 lb · 2 sets')).toBeInTheDocument();
    expect(screen.getByText('reps · 15 lb')).toBeInTheDocument();
    press('Log set 1 · 12 reps');
    // The quiet button under the card reopens the control for set 2.
    press('Change weight');
    expect(screen.getByRole('dialog', { name: 'Change weight' })).toBeInTheDocument();
    press(/lb more/);
    press(/lb more/);
    press('Use 20 lb');
    expect(screen.getByText('12 × 20 lb · 2 sets')).toBeInTheDocument();
    const chips = screen.getAllByText(/^Set [12]$/).map((el) => el.parentElement!.textContent);
    expect(chips[0]).toBe('1215 lbSet 1');
    expect(chips[1]).toBe('·20 lbSet 2');
    press('Log set 2 · 12 reps');
    // The remembered session carries both the loads and the change.
    const snap = readSessionInProgress();
    expect(snap?.logs.s1).toEqual({
      kind: 'reps',
      sets: [12, 12],
      target: 12,
      load: 'bodyweight',
      loads: ['15 lb', '20 lb'],
    });
    expect(snap?.changes).toEqual({ s1: { load: '20 lb' } });
  });

  it('a swap reads as a swap in All steps, the Recap and the summary the coach gets — never a skip', () => {
    const { onComplete } = mount();
    press('Change');
    press(/^Kettlebell hip thrust/);
    press('Log set 1 · 12 reps');
    press('Log set 2 · 12 reps');
    press('All steps');
    expect(screen.getAllByText('Kettlebell hip thrust').length).toBeGreaterThan(1); // the header and the row
    expect(screen.getByText('2×12 @ 40 lb · swapped from Glute bridge')).toBeInTheDocument();
    press('Review & finish ›');
    expect(screen.getByText('2×12 @ 40 lb · swapped from Glute bridge')).toBeInTheDocument();
    expect(screen.queryByText(/skipped|passed over.*hip thrust/i)).toBeNull();
    press('Finish · +10 XP');
    press('Done');
    expect(onComplete).toHaveBeenCalledWith(
      expect.stringContaining('kettlebell hip thrust 2×12 @ 40 lb · swapped from Glute bridge'),
    );
  });

  it('a swapped move that was passed over still says it was swapped in All steps', () => {
    mount();
    press('Change');
    press(/^Kettlebell hip thrust/);
    press('Next step');
    press('All steps');
    expect(screen.getByText('Swapped from Glute bridge · Passed over · you can still do it')).toBeInTheDocument();
  });

  it('a relaunch keeps the swap and the loads', () => {
    mount();
    press('Change');
    press(/^Kettlebell hip thrust/);
    press('Change');
    press(/Add weight/);
    press('Use 40 lb'); // the dial opens on the swapped-in move's own load
    press('Log set 1 · 12 reps');
    const snap = readSessionInProgress();
    cleanup();
    expect(snap?.changes?.s1?.swap?.name).toBe('Kettlebell hip thrust');
    mount({ resume: snap });
    expect(screen.getByText('Kettlebell hip thrust')).toBeInTheDocument();
    expect(screen.getByText('Swapped from Glute bridge')).toBeInTheDocument();
    expect(screen.getByText('Log set 2 · 12 reps')).toBeInTheDocument();
    expect(screen.getByText('Change weight')).toBeInTheDocument();
  });

  it('None on a move the plan left at bodyweight records no change; on a move the plan loaded, it is one', () => {
    mount();
    press('Change');
    press(/Add weight/);
    press(/bodyweight/); // the None chip
    press('Use bodyweight');
    expect(screen.queryByText('Change weight')).toBeNull();
    press('Log set 1 · 12 reps');
    press('Log set 2 · 12 reps');
    const first = readSessionInProgress();
    expect(first?.changes).toEqual({});
    expect(first?.logs.s1).toEqual({ kind: 'reps', sets: [12, 12], target: 12, load: 'bodyweight' });
    cleanup();
    localStorage.clear();

    mount();
    press('Change');
    press(/^Kettlebell hip thrust/); // plan 40 lb
    press('Change');
    press(/Add weight/);
    press(/bodyweight/);
    press('Use bodyweight');
    expect(screen.getByText('Change weight')).toBeInTheDocument();
    press('Log set 1 · 12 reps');
    press('Log set 2 · 12 reps');
    press('All steps');
    expect(screen.getByText('2×12 @ bodyweight (plan said 40 lb) · swapped from Glute bridge')).toBeInTheDocument();
  });

  it('a step that takes no weight and has no alternatives has no Change button', () => {
    mount();
    press('Next step');
    expect(screen.getByText('Walk it off')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
  });
});
