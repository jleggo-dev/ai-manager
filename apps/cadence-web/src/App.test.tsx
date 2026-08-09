import { render, screen, waitFor } from '@testing-library/react';
import { App } from './App.tsx';
import { screenFromPlanStage } from './screenFromPlanStage.ts';

const getPlan = vi.fn();

vi.mock('./lib/api.ts', () => ({
  getPlan: (...args: unknown[]) => getPlan(...args),
  setAuthToken: vi.fn(),
  isDevMode: () => true,
  getHealthDigest: vi.fn(async () => ({ digest: null, created_at: null })),
  postHealthDigest: vi.fn(async () => true),
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

vi.mock('./features/welcome/Welcome.tsx', () => ({
  Welcome: () => <div>Welcome screen</div>,
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
    expect(screenFromPlanStage('new')).toBe('welcome');
    expect(screenFromPlanStage('anything-else')).toBe('welcome');
  });
});

describe('App (dev mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPlan.mockResolvedValue({ stage: 'new' });
  });

  it('routes getPlan stage to the matching screen', async () => {
    const { unmount } = render(<App />);
    await waitFor(() => expect(screen.getByText('Welcome screen')).toBeInTheDocument());
    unmount();

    getPlan.mockResolvedValueOnce({ stage: 'in_progress' });
    const mid = render(<App />);
    await waitFor(() => expect(mid.getByText('Onboarding chat')).toBeInTheDocument());
    mid.unmount();

    getPlan.mockResolvedValueOnce({ stage: 'committed' });
    render(<App />);
    await waitFor(() => expect(screen.getByText('Main tabs')).toBeInTheDocument());
  });

  it('falls back to welcome when getPlan fails', async () => {
    getPlan.mockRejectedValueOnce(new Error('offline'));
    render(<App />);
    await waitFor(() => expect(screen.getByText('Welcome screen')).toBeInTheDocument());
  });
});
