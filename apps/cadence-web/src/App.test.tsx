import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App.tsx';
import { clearBootCache, createAppQueryClient } from './lib/query/index.ts';
import { screenFromPlanStage } from './screenFromPlanStage.ts';

/**
 * App routes through the shared query cache now (PERF-02: the gate's `/plan` fetch IS the one
 * PlanView paints from), so it needs a provider. Built with the APP's own factory rather than a
 * bare QueryClient — `retry: 1` is what makes "absorbs a single blip" a real assertion instead of
 * one that passes because the test client never retried. Fresh per render: a shared cache would
 * let one case's plan satisfy the next case's gate.
 */
const renderApp = () => {
  const client = createAppQueryClient();
  // Keep the app's retry COUNT (that is the contract these tests assert) but drop its backoff
  // DELAY: react-query waits ~1s before retry one, which outlives waitFor's default and made
  // these read as failures when the behaviour was correct. Timing is not the contract.
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retryDelay: 0 } });
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
};

const getPlan = vi.fn();

vi.mock('./lib/api.ts', () => ({
  getPlan: (...args: unknown[]) => getPlan(...args),
  setAuthToken: vi.fn(),
  isDevMode: () => true,
  getHealthDigest: vi.fn(async () => ({ digest: null, created_at: null })),
  postHealthDigest: vi.fn(async () => true),
  postWorkoutHistory: vi.fn(async () => true),
  // App now wraps the screen machine in CoachFaceProvider, which reads the picked portrait.
  getCoachFace: vi.fn(async () => ({ ok: true, faceId: null })),
  setCoachFace: vi.fn(async () => null),
}));

vi.mock('./lib/supabase.ts', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
  readPersistedSession: () => null,
}));

vi.mock('./features/onboarding/MeetCadence.tsx', () => ({
  MeetCadence: () => <div>Meet Cadence</div>,
}));
vi.mock('./features/onboarding/BuildingScreen.tsx', () => ({
  BuildingScreen: () => <div>Building</div>,
}));
vi.mock('./features/auth/SignUpGate.tsx', () => ({
  SignUpGate: () => <div>Sign-up gate</div>,
}));
vi.mock('./features/onboarding/OnboardingChat.tsx', () => ({
  OnboardingChat: () => <div>Onboarding chat</div>,
}));
vi.mock('./features/review/ReviewScreen.tsx', () => ({
  ReviewScreen: () => <div>Review</div>,
}));
vi.mock('./features/shell/MainTabs.tsx', () => ({
  MainTabs: () => <div>Main tabs</div>,
}));
vi.mock('./features/dev/DevPanel.tsx', () => ({ DevPanel: () => null }));
vi.mock('./features/dev/AccountSwitcher.tsx', () => ({ AccountSwitcher: () => null }));
vi.mock('./features/auth/AuthScreen.tsx', () => ({
  AuthScreen: () => <div>Auth screen</div>,
}));
vi.mock('./components/PhoneFrame.tsx', () => ({
  PhoneFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('screenFromPlanStage', () => {
  it('maps plan stages to the top-level screen machine', () => {
    expect(screenFromPlanStage('committed')).toBe('plan');
    expect(screenFromPlanStage('in_progress')).toBe('onboarding');
    expect(screenFromPlanStage('new')).toBe('meet');
    expect(screenFromPlanStage('anything-else')).toBe('meet');
  });
});

describe('App (dev mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPlan.mockResolvedValue({ stage: 'new' });
  });

  it('routes getPlan stage to the matching screen', async () => {
    const { unmount } = renderApp();
    await waitFor(() => expect(screen.getByText('Meet Cadence')).toBeInTheDocument());
    unmount();

    getPlan.mockResolvedValueOnce({ stage: 'in_progress' });
    const mid = renderApp();
    await waitFor(() => expect(mid.getByText('Onboarding chat')).toBeInTheDocument());
    mid.unmount();

    getPlan.mockResolvedValueOnce({ stage: 'committed' });
    renderApp();
    await waitFor(() => expect(screen.getByText('Main tabs')).toBeInTheDocument());
  });

  /**
   * The old assertion here — "falls back to meeting the coach when getPlan fails" — WAS the bug.
   * A cold start or a 401 blip right after sign-in dressed a signed-in owner with a full plan as
   * a brand-new user and restarted onboarding at him (2026-08-19). Failure is now a named state
   * with a retry, and "meet" is reserved for people who are genuinely new.
   */
  it('shows a retry — never the meet screen — when the plan cannot load', async () => {
    getPlan.mockResolvedValue(null); // both the load and its one silent retry fail
    renderApp();
    await waitFor(() => expect(screen.getByText(/safe on the server/)).toBeInTheDocument());
    expect(screen.queryByText('Meet Cadence')).not.toBeInTheDocument();

    // The retry is live: the plan comes back, and so does the app.
    getPlan.mockResolvedValue({ stage: 'committed' });
    fireEvent.click(screen.getByText('Try again'));
    await waitFor(() => expect(screen.getByText('Main tabs')).toBeInTheDocument());
  });

  it('absorbs a single blip with the silent retry', async () => {
    getPlan.mockResolvedValueOnce(null).mockResolvedValueOnce({ stage: 'committed' });
    renderApp();
    await waitFor(() => expect(screen.getByText('Main tabs')).toBeInTheDocument());
  });
});

/**
 * The boot paint (lib/query/boot-cache.ts) reaching the screen machine. These are the app-level
 * half of what boot-cache.test.ts asserts about the cache itself: that a remembered plan opens the
 * shell without waiting, and — the part that matters far more — that a remembered plan can never
 * open onboarding or take a working screen away.
 */
describe('App (opening from the boot cache)', () => {
  const seedCommittedPlan = () => {
    const client = createAppQueryClient();
    client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retryDelay: 0 } });
    // Seeded the way seedBootCache does — with the ORIGINAL answer's timestamp, so the entry is
    // already past staleTime and `fetchQuery` really revalidates. Stamp it `now` and fetchQuery
    // short-circuits on fresh data, which would make every assertion below about the wrong thing.
    client.setQueryData(
      ['plan'],
      { stage: 'committed', hasPlan: true, activities: [], week: [] },
      {
        updatedAt: Date.now() - 60_000,
      },
    );
    return client;
  };
  const renderWith = (client: ReturnType<typeof createAppQueryClient>) =>
    render(
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>,
    );

  /**
   * `owner: null` matches this file's mocked `readPersistedSession` — these cases are about App's
   * screen machine, and boot-cache.test.ts is where ownership itself is asserted. `clearBootCache`
   * first, because the module memoizes the snapshot it read: without it, case one's answer would
   * still be the answer four cases later.
   */
  const remember = (stage: string | null, owner: string | null = null) =>
    window.localStorage.setItem(
      'cadence.bootCache',
      JSON.stringify({ v: 2, owner, at: Date.now(), stage, entries: [] }),
    );

  beforeEach(() => {
    vi.clearAllMocks();
    clearBootCache();
    remember('committed');
  });

  it('opens on the plan with no loading state, then revalidates behind it', async () => {
    // A fetch that never settles: whatever is on screen got there without the network.
    getPlan.mockImplementation(() => new Promise(() => {}));
    renderWith(seedCommittedPlan());
    expect(screen.getByText('Main tabs')).toBeInTheDocument();
    expect(screen.queryByText('Loading your week.')).not.toBeInTheDocument();
    await waitFor(() => expect(getPlan).toHaveBeenCalled()); // ...and it still asked
  });

  /**
   * The 2026-08-19 shape, from the new direction. A snapshot is a WEAKER source than the failed
   * request that caused that bug, so it must not be able to do what that bug did.
   */
  it('never routes out of the plan on a failed refresh — the cached week stays up', async () => {
    getPlan.mockResolvedValue(null); // load + silent retry both fail
    renderWith(seedCommittedPlan());
    await waitFor(() => expect(getPlan).toHaveBeenCalled());
    expect(screen.getByText('Main tabs')).toBeInTheDocument();
    expect(screen.queryByText(/safe on the server/)).not.toBeInTheDocument();
    expect(screen.queryByText('Meet Cadence')).not.toBeInTheDocument();
  });

  it('still corrects itself when the server says the plan is gone', async () => {
    getPlan.mockResolvedValue({ stage: 'new' });
    renderWith(seedCommittedPlan());
    await waitFor(() => expect(screen.getByText('Meet Cadence')).toBeInTheDocument());
  });

  it("shows the skeleton, not a remembered shell, when the snapshot is another account's", async () => {
    clearBootCache();
    remember('committed', 'someone-else');
    getPlan.mockImplementation(() => new Promise(() => {}));
    const client = createAppQueryClient();
    renderWith(client);
    expect(screen.getByText('Loading your week.')).toBeInTheDocument();
    expect(screen.queryByText('Main tabs')).not.toBeInTheDocument();
  });
});
