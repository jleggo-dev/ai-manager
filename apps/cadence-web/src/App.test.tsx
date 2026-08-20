import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App.tsx';
import { createAppQueryClient } from './lib/query/index.ts';
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
  getCoachFace: vi.fn(async () => null),
  setCoachFace: vi.fn(async () => null),
}));

vi.mock('./lib/supabase.ts', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
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
