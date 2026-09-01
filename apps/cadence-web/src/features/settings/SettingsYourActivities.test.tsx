/**
 * Settings › Your activities (Activity Builder wave 3, W3-3). Same press-to-wire bar as
 * `SettingsGoals.test.tsx`: every ⋯ action calls its exact contract function with exact args, the
 * three list states render three different strings, and — the one thing goals never needed —
 * "Run it now" actually plays (the Walkthrough stubbed the same way `QuickAddTense.test.tsx`
 * stubs it) and credits on completion.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { UserRoutine } from '../../lib/api.ts';

const api = vi.hoisted(() => ({
  listUserRoutines: vi.fn(),
  updateUserRoutine: vi.fn(),
  deleteUserRoutine: vi.fn(),
  createUserRoutine: vi.fn(),
  scheduleUserRoutine: vi.fn(),
  unscheduleUserRoutine: vi.fn(),
  logUserRoutineRun: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
}));
vi.mock('../../lib/api.ts', () => api);

// The player belongs to another surface entirely — this suite only needs to know the section
// hands it the right routine and reacts to completion/close, the same stand-in QuickAddTense's
// own suite uses for the coach-routine sibling.
vi.mock('../walkthrough/Walkthrough.tsx', () => ({
  Walkthrough: ({ title, onComplete, onClose }: { title: string; onComplete: () => void; onClose: () => void }) => (
    <div>
      <div>playing: {title}</div>
      <button onClick={onComplete}>Finish</button>
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

const { SettingsYourActivities } = await import('./SettingsYourActivities.tsx');

const SESSION = {
  blocks: [
    {
      label: '',
      items: [
        { name: 'Warm-up', duration_min: 5 },
        { name: 'Work', duration_min: 7 },
      ],
    },
  ],
  note: '',
  generated_at: '',
  version: 1,
};

function routine(over: Partial<UserRoutine> = {}): UserRoutine {
  return {
    routine_id: 'r1',
    name: 'Hotel HIIT',
    session: SESSION,
    provenance: { kind: 'blank' },
    created_at: '',
    updated_at: '',
    runs: 4,
    last_run: null,
    schedule: null,
    ...over,
  };
}

async function openMenu(name = 'Hotel HIIT') {
  await screen.findByText(name);
  fireEvent.click(screen.getByLabelText(`Options for ${name}`));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SettingsYourActivities — the three list states', () => {
  it('renders a row with real-facts-only meta when loaded', async () => {
    api.listUserRoutines.mockResolvedValueOnce([routine()]);
    render(<SettingsYourActivities onBack={() => {}} />);

    expect(await screen.findByText('Hotel HIIT')).toBeInTheDocument();
    expect(screen.getByText('2 steps · 12 min · run 4 times')).toBeInTheDocument();
  });

  it('shows "never run" for a routine with zero runs, and the schedule when it has one', async () => {
    api.listUserRoutines.mockResolvedValueOnce([
      routine({
        routine_id: 'r2',
        name: 'Sunday reset sit',
        runs: 0,
        schedule: { days: ['tue', 'fri'], time_of_day: 'evening' },
      }),
    ]);
    render(<SettingsYourActivities onBack={() => {}} />);
    expect(await screen.findByText('2 steps · 12 min · never run · on the plan Tue & Fri')).toBeInTheDocument();
  });

  it('shows the quiet empty-state line — never the load-failure line', async () => {
    api.listUserRoutines.mockResolvedValueOnce([]);
    render(<SettingsYourActivities onBack={() => {}} />);
    expect(
      await screen.findByText('Nothing built yet — the ＋ on your plan is where an activity starts.'),
    ).toBeInTheDocument();
  });

  it('shows the honest load-failure line on a null response — a DIFFERENT string than empty', async () => {
    api.listUserRoutines.mockResolvedValueOnce(null);
    render(<SettingsYourActivities onBack={() => {}} />);
    expect(await screen.findByText("Couldn't load your activities just now — try again shortly.")).toBeInTheDocument();
    expect(
      screen.queryByText('Nothing built yet — the ＋ on your plan is where an activity starts.'),
    ).not.toBeInTheDocument();
  });
});

describe('SettingsYourActivities — rename', () => {
  it('renames through updateUserRoutine with the exact id and patch', async () => {
    api.listUserRoutines.mockResolvedValueOnce([routine()]);
    api.updateUserRoutine.mockResolvedValueOnce(routine({ name: 'Hotel HIIT v2' }));
    render(<SettingsYourActivities onBack={() => {}} />);
    await openMenu();

    fireEvent.click(screen.getByText('Rename'));
    const input = screen.getByLabelText('Rename Hotel HIIT');
    fireEvent.change(input, { target: { value: 'Hotel HIIT v2' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(api.updateUserRoutine).toHaveBeenCalledWith('r1', { name: 'Hotel HIIT v2' }));
    expect(await screen.findByText('Hotel HIIT v2')).toBeInTheDocument();
  });
});

describe('SettingsYourActivities — duplicate', () => {
  it('calls createUserRoutine with " 2" suffixed name, the same session, and the preserved provenance', async () => {
    const src = routine({ provenance: { kind: 'from_cadence', source_commitment_id: 'c9' } });
    api.listUserRoutines.mockResolvedValueOnce([src]);
    api.createUserRoutine.mockResolvedValueOnce(routine({ routine_id: 'r-dup', name: 'Hotel HIIT 2' }));
    render(<SettingsYourActivities onBack={() => {}} />);
    await openMenu();

    fireEvent.click(screen.getByText('Duplicate'));

    await waitFor(() =>
      expect(api.createUserRoutine).toHaveBeenCalledWith({
        name: 'Hotel HIIT 2',
        session: SESSION,
        provenance: { kind: 'from_cadence', source_commitment_id: 'c9' },
      }),
    );
    expect(await screen.findByText('Hotel HIIT 2')).toBeInTheDocument();
  });

  it('carries the area along when the source routine has one', async () => {
    api.listUserRoutines.mockResolvedValueOnce([routine({ area: 'movement' })]);
    api.createUserRoutine.mockResolvedValueOnce(
      routine({ routine_id: 'r-dup', name: 'Hotel HIIT 2', area: 'movement' }),
    );
    render(<SettingsYourActivities onBack={() => {}} />);
    await openMenu();
    fireEvent.click(screen.getByText('Duplicate'));

    await waitFor(() =>
      expect(api.createUserRoutine).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Hotel HIIT 2', area: 'movement' }),
      ),
    );
  });
});

describe('SettingsYourActivities — delete', () => {
  it('the light confirm names the routine and counts real runs — "Keep it" calls nothing', async () => {
    api.listUserRoutines.mockResolvedValueOnce([routine({ runs: 4 })]);
    render(<SettingsYourActivities onBack={() => {}} />);
    await openMenu();

    fireEvent.click(screen.getByText('Delete…'));
    expect(screen.getByText('Delete "Hotel HIIT"?')).toBeInTheDocument();
    expect(screen.getByText(/The 4 sessions you logged with it stay in your history\./)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Keep it'));
    expect(api.deleteUserRoutine).not.toHaveBeenCalled();
    expect(screen.queryByText('Delete "Hotel HIIT"?')).not.toBeInTheDocument();
    expect(screen.getByText('Hotel HIIT')).toBeInTheDocument();
  });

  it('"Delete" calls deleteUserRoutine with the routine id and drops the row on success', async () => {
    api.listUserRoutines.mockResolvedValueOnce([routine()]);
    api.deleteUserRoutine.mockResolvedValueOnce(true);
    render(<SettingsYourActivities onBack={() => {}} />);
    await openMenu();
    fireEvent.click(screen.getByText('Delete…'));
    fireEvent.click(screen.getByText('Delete'));

    await waitFor(() => expect(api.deleteUserRoutine).toHaveBeenCalledWith('r1'));
    expect(screen.queryByText('Hotel HIIT')).not.toBeInTheDocument();
  });
});

describe('SettingsYourActivities — the Edit steps seam', () => {
  it('hides "Edit steps" when onEditRoutine is absent', async () => {
    api.listUserRoutines.mockResolvedValueOnce([routine()]);
    render(<SettingsYourActivities onBack={() => {}} />);
    await openMenu();
    expect(screen.queryByText('Edit steps')).not.toBeInTheDocument();
  });

  it('calls onEditRoutine with the routine when present', async () => {
    const onEditRoutine = vi.fn();
    api.listUserRoutines.mockResolvedValueOnce([routine()]);
    render(<SettingsYourActivities onBack={() => {}} onEditRoutine={onEditRoutine} />);
    await openMenu();
    fireEvent.click(screen.getByText('Edit steps'));
    expect(onEditRoutine).toHaveBeenCalledWith(routine());
  });
});

describe('SettingsYourActivities — Run it now', () => {
  it('plays the routine straight from its own session and credits logUserRoutineRun on completion', async () => {
    api.listUserRoutines.mockResolvedValueOnce([routine()]);
    render(<SettingsYourActivities onBack={() => {}} />);
    await openMenu();

    fireEvent.click(screen.getByText('Run it now'));
    expect(await screen.findByText('playing: Hotel HIIT')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Finish'));
    await waitFor(() => expect(api.logUserRoutineRun).toHaveBeenCalledWith('r1'));
    // Back on the list, with the optimistic run count bumped.
    expect(await screen.findByText('2 steps · 12 min · run 5 times')).toBeInTheDocument();
  });

  it('closing without finishing never credits anything', async () => {
    api.listUserRoutines.mockResolvedValueOnce([routine()]);
    render(<SettingsYourActivities onBack={() => {}} />);
    await openMenu();
    fireEvent.click(screen.getByText('Run it now'));
    await screen.findByText('playing: Hotel HIIT');

    fireEvent.click(screen.getByText('Close'));
    expect(await screen.findByText('Hotel HIIT')).toBeInTheDocument();
    expect(api.logUserRoutineRun).not.toHaveBeenCalled();
  });
});

describe('SettingsYourActivities — Schedule it…', () => {
  it('opens the schedule sheet naming the routine, and writes the schedule back onto the row', async () => {
    api.listUserRoutines.mockResolvedValueOnce([routine({ schedule: null })]);
    api.scheduleUserRoutine.mockResolvedValueOnce({ ok: true });
    render(<SettingsYourActivities onBack={() => {}} />);
    await openMenu();

    fireEvent.click(screen.getByText('Schedule it…'));
    expect(await screen.findByRole('dialog', { name: 'Schedule Hotel HIIT' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('Tue'));
    fireEvent.click(screen.getByText('Put it on the plan'));

    await waitFor(() =>
      expect(api.scheduleUserRoutine).toHaveBeenCalledWith('r1', { days: ['tue'], time_of_day: 'anytime' }),
    );
    expect(await screen.findByText('2 steps · 12 min · run 4 times · on the plan Tue')).toBeInTheDocument();
  });
});
