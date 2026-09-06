/**
 * The Settings Room shell (SR-3): groups render, doors navigate and come back, a live toggle
 * calls its endpoint, and the Erase gate stays dead until the exact phrase is typed — same
 * mocking idiom as `SettingsSheet.test.tsx`, the sheet this room replaces.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/query/keys.ts';
import { makeTestQueryClient, renderWithQuery } from '../../test/withQuery.tsx';
import { SettingsRoom } from './SettingsRoom.tsx';

const api = {
  getReview: vi.fn(),
  getConstraints: vi.fn(),
  getUnits: vi.fn(),
  setUnits: vi.fn(),
  getNotificationPrefs: vi.fn(),
  saveNotificationPrefs: vi.fn(),
  getProgressPhotosStatus: vi.fn(),
  setProgressPhotosEnabled: vi.fn(),
  getHomeLocation: vi.fn(),
  saveHomeLocation: vi.fn(),
  clearHomeLocation: vi.fn(),
  updateBaseline: vi.fn(),
  recordWeighInToday: vi.fn(),
  deleteMyData: vi.fn(),
  resetAccount: vi.fn(),
  isDevMode: vi.fn(() => false),
  getDevAccount: vi.fn(() => 'scratch'),
};

vi.mock('../../lib/api.ts', () => ({
  getReview: (...a: unknown[]) => api.getReview(...a),
  getConstraints: (...a: unknown[]) => api.getConstraints(...a),
  getUnits: (...a: unknown[]) => api.getUnits(...a),
  setUnits: (...a: unknown[]) => api.setUnits(...a),
  getNotificationPrefs: (...a: unknown[]) => api.getNotificationPrefs(...a),
  saveNotificationPrefs: (...a: unknown[]) => api.saveNotificationPrefs(...a),
  registerPushToken: vi.fn(),
  removePushToken: vi.fn(),
  getProgressPhotosStatus: (...a: unknown[]) => api.getProgressPhotosStatus(...a),
  setProgressPhotosEnabled: (...a: unknown[]) => api.setProgressPhotosEnabled(...a),
  getHomeLocation: (...a: unknown[]) => api.getHomeLocation(...a),
  saveHomeLocation: (...a: unknown[]) => api.saveHomeLocation(...a),
  clearHomeLocation: (...a: unknown[]) => api.clearHomeLocation(...a),
  browserTimezone: () => 'UTC',
  logAdhoc: vi.fn(),
  updateBaseline: (...a: unknown[]) => api.updateBaseline(...a),
  recordWeighInToday: (...a: unknown[]) => api.recordWeighInToday(...a),
  deleteMyData: (...a: unknown[]) => api.deleteMyData(...a),
  resetAccount: (...a: unknown[]) => api.resetAccount(...a),
  isDevMode: () => api.isDevMode(),
  getDevAccount: () => api.getDevAccount(),
}));

const getSession = vi.fn();
vi.mock('../../lib/supabase.ts', () => ({
  supabase: {
    auth: {
      getSession: (...a: unknown[]) => getSession(...a),
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn(),
    },
  },
}));

vi.mock('../../lib/capability/index.ts', () => ({
  capabilities: {
    location: { isAvailable: () => false, getCoarseLocation: async () => null },
    health: { isAvailable: () => false },
    push: { isAvailable: () => true, register: async () => 'tok-1' },
    coachIdentity: { isAvailable: () => false },
  },
}));

const REVIEW = {
  name: 'Jordan',
  goals: [
    { goal_id: 'g1', status: 'committed' },
    { goal_id: 'g2', status: 'confirmed' },
    { goal_id: 'g3', status: 'abandoned' }, // not "on the plan" — should not be counted
  ],
  equipment: [{ name: 'Kettlebell' }, { name: 'Bands' }],
  baseline: { weigh_in_cadence: 'weekly', weight_unit: 'lb' },
  guardrail: { weightedLoad: 0, activeCount: 0, overFocusBudget: false, exceedsHardCap: false },
  confirmable: true,
  lockable: true,
};

const PREFS = {
  enabled: true,
  tier: 'moderate' as const,
  quietStartMin: 21 * 60 + 30,
  quietEndMin: 7 * 60,
  includes: [],
  excludes: [],
  maxPerDay: 1,
};

// The edit-steps round trip (W3-5 integration wiring): the list and the builder are each their
// own well-tested surface — here they are stubs with exactly the controls the ROOM's wiring
// contract cares about: the list hands a routine to onEditRoutine; the builder receives update
// props and hands back onSaved/onClose.
const EDIT_FIXTURE = {
  routine_id: 'r-edit-1',
  name: 'Hotel HIIT',
  area: 'movement',
  session: {
    blocks: [{ label: '', items: [{ name: 'Work', duration_min: 8 }] }],
    note: '',
    generated_at: 'x',
    version: 1,
  },
  provenance: { kind: 'blank' },
  created_at: 'x',
  updated_at: 'x',
  runs: 2,
  last_run: null,
  schedule: null,
};
vi.mock('./SettingsYourActivities.tsx', () => ({
  SettingsYourActivities: ({ onEditRoutine }: { onEditRoutine?: (r: unknown) => void }) => (
    <div>
      <span>your-activities-list</span>
      {onEditRoutine && <button onClick={() => onEditRoutine(EDIT_FIXTURE)}>edit-steps</button>}
    </div>
  ),
}));
vi.mock('../builder/ActivityBuilder.tsx', () => ({
  ActivityBuilder: ({
    updateRoutineId,
    initial,
    onSaved,
    onClose,
  }: {
    updateRoutineId?: string;
    initial?: { name?: string };
    onSaved: (r: unknown) => void;
    onClose: () => void;
  }) => (
    <div>
      <span>{`builder-editing:${updateRoutineId}:${initial?.name}`}</span>
      <button onClick={() => onSaved(EDIT_FIXTURE)}>builder-save</button>
      <button onClick={onClose}>builder-close</button>
    </div>
  ),
}));

function renderRoom(email: string | null = 'you@example.com', client: QueryClient = makeTestQueryClient()) {
  return renderWithQuery(<SettingsRoom email={email} onBack={() => {}} />, client);
}

beforeEach(() => {
  vi.clearAllMocks();
  api.isDevMode.mockReturnValue(false);
  api.getReview.mockResolvedValue(REVIEW);
  api.getConstraints.mockResolvedValue([{ id: 'c1', label: 'bad knee' }]);
  api.getUnits.mockResolvedValue({
    prefs: null,
    resolved: { body_weight: 'lb', height: 'ft_in', food_mass: 'g', food_volume: 'cup', distance: 'km' },
  });
  api.setUnits.mockResolvedValue(null);
  api.getNotificationPrefs.mockResolvedValue({ ...PREFS });
  api.saveNotificationPrefs.mockResolvedValue(null);
  api.getProgressPhotosStatus.mockResolvedValue({ enabled: false, count: 0, next_due: null });
  api.setProgressPhotosEnabled.mockResolvedValue(true);
  api.getHomeLocation.mockResolvedValue({
    home_location: null,
    current_location: null,
    timezone: null,
    available: true,
  });
  api.deleteMyData.mockResolvedValue(true);
  api.resetAccount.mockResolvedValue(undefined);
  getSession.mockResolvedValue({ data: { session: null } });
});

describe('SettingsRoom — the groups and their rows', () => {
  it('renders the header and all three groups', async () => {
    renderRoom();
    expect(await screen.findByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('You & your coach')).toBeInTheDocument();
    expect(screen.getByText('Device & data')).toBeInTheDocument();
    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.getByText('Danger zone')).toBeInTheDocument();
  });

  it('counts only non-abandoned goals as "on the plan"', async () => {
    renderRoom();
    expect(await screen.findByText(/Rename or retire a goal · 2 on the plan/)).toBeInTheDocument();
  });

  /**
   * The bug this screen was reported for: it opened with "Rename or retire a goal" and no count,
   * and filled the number in a round trip later — every visit, because the fetch lived in a
   * `useEffect` and the answer died with the screen. Through the shared cache the room opens
   * finished. `getByText` rather than `findByText` is the whole assertion: no await, no act, no
   * promise has resolved yet, and the row already says what it says.
   */
  it('paints the counts on the first frame from what is already cached', () => {
    const client = makeTestQueryClient();
    client.setQueryData(queryKeys.review.all, REVIEW);
    client.setQueryData(queryKeys.constraints.all, [{ id: 'c1', label: 'bad knee' }]);

    renderRoom('you@example.com', client);

    expect(screen.getByText(/Rename or retire a goal · 2 on the plan/)).toBeInTheDocument();
    expect(screen.getByText(/2 things · Kettlebell, Bands/)).toBeInTheDocument();
    expect(screen.getByText(/bad knee · read-only here/)).toBeInTheDocument();
    expect(screen.queryByText(/Loading…/)).not.toBeInTheDocument();
  });

  /** And the owner's own description of what SHOULD happen when the fact has moved: last launch's
   *  number is on screen immediately, and it corrects itself when the server answers. */
  it('paints a stale boot-cache count first, then corrects it', async () => {
    const client = makeTestQueryClient();
    client.setQueryData(
      queryKeys.review.all,
      { ...REVIEW, goals: [{ goal_id: 'g1', status: 'committed' }] },
      {
        // The time the server actually answered — how `seedBootCache` lands last launch's answers,
        // so the entry is stale on arrival and revalidates on mount.
        updatedAt: Date.now() - 60 * 60_000,
      },
    );

    renderRoom('you@example.com', client);

    expect(screen.getByText(/Rename or retire a goal · 1 on the plan/)).toBeInTheDocument();
    expect(await screen.findByText(/Rename or retire a goal · 2 on the plan/)).toBeInTheDocument();
  });

  it('previews the equipment list on the tools row', async () => {
    renderRoom();
    expect(await screen.findByText(/2 things · Kettlebell, Bands/)).toBeInTheDocument();
  });

  it('shows constraints read-only, with no door to edit them', async () => {
    renderRoom();
    expect(await screen.findByText(/bad knee · read-only here/)).toBeInTheDocument();
    // A static row, not a button — nothing to tap.
    expect(screen.queryByRole('button', { name: /bad knee/ })).not.toBeInTheDocument();
  });

  it('sources WEEK N from the Supabase session’s created_at, when one exists', async () => {
    getSession.mockResolvedValue({
      data: { session: { user: { created_at: new Date(Date.now() - 10 * 86_400_000).toISOString() } } },
    });
    renderRoom();
    expect(await screen.findByText(/WEEK 2/)).toBeInTheDocument();
  });

  it('omits WEEK when there is no session to source it from (e.g. dev mode)', async () => {
    renderRoom();
    await screen.findByText('Settings');
    expect(screen.queryByText(/WEEK/)).not.toBeInTheDocument();
  });
});

describe('SettingsRoom — doors navigate, and back returns', () => {
  it('opens Units as a full screen and back returns to the root list', async () => {
    renderRoom();
    fireEvent.click(await screen.findByRole('button', { name: /Units/ }));
    expect(await screen.findByRole('group', { name: 'Your weight' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to Settings' }));
    expect(await screen.findByText('You & your coach')).toBeInTheDocument();
  });

  it('opens Notifications with LIVE tier/quiet-hours values in its own row', async () => {
    renderRoom();
    expect(await screen.findByText(/Moderate · quiet 21:30 – 07:00/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    expect(await screen.findByRole('radio', { name: /Moderate/ })).toBeInTheDocument();
  });

  it('opens the coach-face door already expanded — no second tap to reveal the grid', async () => {
    renderRoom();
    fireEvent.click(await screen.findByText('Cadence'));
    expect(await screen.findByRole('radiogroup', { name: /face/i })).toBeInTheDocument();
  });
});

describe('SettingsRoom — Progress photos toggle', () => {
  it('calls the enable endpoint and flips on tap', async () => {
    renderRoom();
    const toggle = await screen.findByRole('switch', { name: /Progress photos/ });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(toggle);
    await waitFor(() => expect(api.setProgressPhotosEnabled).toHaveBeenCalledWith(true));
    expect(await screen.findByRole('switch', { name: /Progress photos/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('points at Progress for the actual photos', async () => {
    renderRoom();
    expect(await screen.findByText('All photos live in Progress')).toBeInTheDocument();
  });
});

describe('SettingsRoom — the Erase gate', () => {
  it('keeps Erase disabled until the exact phrase is typed', async () => {
    renderRoom();
    const erase = await screen.findByRole('button', { name: 'Erase it all' });
    expect(erase).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('start over'), { target: { value: 'nope' } });
    expect(erase).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('start over'), { target: { value: 'Start Over' } });
    expect(erase).not.toBeDisabled();
  });

  it('erasing calls deleteMyData with the confirmation phrase', async () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } });

    renderRoom();
    fireEvent.change(await screen.findByPlaceholderText('start over'), { target: { value: 'start over' } });
    fireEvent.click(screen.getByRole('button', { name: 'Erase it all' }));

    await waitFor(() => expect(api.deleteMyData).toHaveBeenCalledWith('start over'));
    expect(reload).toHaveBeenCalled();
  });
});

describe('SettingsRoom — the edit-steps door hosts the builder in update mode', () => {
  it('edit press mounts the builder with the routine, save returns to the list', async () => {
    renderRoom();
    fireEvent.click(await screen.findByRole('button', { name: /Your activities/ }));
    fireEvent.click(await screen.findByText('edit-steps'));
    // The exact wiring contract: update mode with THIS routine's id, seeded with its name.
    expect(await screen.findByText('builder-editing:r-edit-1:Hotel HIIT')).toBeInTheDocument();

    fireEvent.click(screen.getByText('builder-save'));
    // Back on the (remounted) list — a fresh fetch, so the edit is read back, never patched by hand.
    expect(await screen.findByText('your-activities-list')).toBeInTheDocument();
  });

  it('closing the builder without saving also returns to the list', async () => {
    renderRoom();
    fireEvent.click(await screen.findByRole('button', { name: /Your activities/ }));
    fireEvent.click(await screen.findByText('edit-steps'));
    fireEvent.click(await screen.findByText('builder-close'));
    expect(await screen.findByText('your-activities-list')).toBeInTheDocument();
  });
});
