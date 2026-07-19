import type { ReactNode } from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';

vi.mock('./lib/auth-session', () => ({
  initAuthSession: vi.fn(() => Promise.resolve(() => {})),
  getAccessToken: vi.fn(() => null),
  getSessionUser: vi.fn(() => null),
  getWorkspaceId: vi.fn(() => null),
  setWorkspaceId: vi.fn(),
  signOut: vi.fn(() => Promise.resolve()),
  clearAuthSession: vi.fn(),
  // App.tsx gates rendering on this; default to 'approved' so token-bearing
  // tests reach the app shell without every test having to override it.
  getAccountStatus: vi.fn(() => 'approved'),
  onAccountStatusChange: vi.fn(() => () => {}),
  refreshBootstrap: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('./services/api', () => ({
  listWorkspaces: vi.fn(() => Promise.resolve({ workspaces: [] })),
}));

vi.mock('./layouts/AppShell', () => ({
  default: ({ children, activePage }: { children: ReactNode; activePage: string }) => (
    <div data-testid="app-shell" data-active={activePage}>
      <nav data-testid="shell-nav" />
      {children}
    </div>
  ),
}));

vi.mock('./components/auth/AuthLanding', () => ({
  default: () => <div data-testid="auth-landing">Auth Landing</div>,
}));

vi.mock('./pages/ProvidersPage', () => ({
  default: () => <div data-testid="page-providers">Providers</div>,
}));
vi.mock('./pages/AiProfilesPage', () => ({
  default: () => <div data-testid="page-ai-profiles">AI Profiles</div>,
}));
vi.mock('./pages/ProcessingJobsPage', () => ({
  default: () => <div data-testid="page-processing-jobs">Processing Jobs</div>,
}));
vi.mock('./pages/AiMatcherPage', () => ({
  default: () => <div data-testid="page-ai-matcher">AI Matcher</div>,
}));
vi.mock('./pages/SettingsPage', () => ({
  default: () => <div data-testid="page-settings">Settings</div>,
}));
vi.mock('./pages/TeamPage', () => ({
  default: () => <div data-testid="page-team">Team</div>,
}));
vi.mock('./pages/LovableGuidePage', () => ({
  default: () => <div data-testid="page-lovable">Lovable Guide</div>,
}));
vi.mock('./pages/WorkflowsPage', () => ({
  default: () => <div data-testid="page-workflows">Workflows</div>,
}));
vi.mock('./pages/WorkflowEditorPage', () => ({
  default: () => <div data-testid="page-workflow-editor">Workflow Editor</div>,
}));
vi.mock('./pages/WorkflowDetailPage', () => ({
  default: () => <div data-testid="page-workflow-detail">Workflow Detail</div>,
}));
vi.mock('./pages/HealthDashboardPage', () => ({
  default: () => <div data-testid="page-hc-dashboard">Health Dashboard</div>,
}));
vi.mock('./pages/HealthCheckProvidersPage', () => ({
  default: () => <div data-testid="page-hc-providers">HC Providers</div>,
}));
vi.mock('./pages/HealthCheckProfilesPage', () => ({
  default: () => <div data-testid="page-hc-profiles">HC Profiles</div>,
}));
vi.mock('./pages/HealthCheckConfigPage', () => ({
  default: () => <div data-testid="page-hc-checks">HC Checks</div>,
}));

import App from './App';
import * as authSession from './lib/auth-session';

function renderApp() {
  return render(
    <MantineProvider>
      <ModalsProvider>
        <App />
      </ModalsProvider>
    </MantineProvider>,
  );
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (authSession.initAuthSession as ReturnType<typeof vi.fn>).mockResolvedValue(() => {});
    (authSession.getAccessToken as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (authSession.getSessionUser as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (authSession.getWorkspaceId as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (authSession.signOut as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('renders without crashing (smoke test)', () => {
    const { unmount } = renderApp();
    unmount();
  });

  it('unsubscribes the auth session listener on unmount', async () => {
    const unsubscribe = vi.fn();
    (authSession.initAuthSession as ReturnType<typeof vi.fn>).mockResolvedValue(unsubscribe);

    const { unmount } = renderApp();

    await waitFor(() => {
      expect(authSession.initAuthSession).toHaveBeenCalled();
    });
    // Allow the init promise to settle and stash the unsubscribe handle.
    await waitFor(() => {
      expect(unsubscribe).not.toHaveBeenCalled();
    });

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('shows loading spinner during auth initialization', () => {
    (authSession.initAuthSession as ReturnType<typeof vi.fn>).mockReturnValue(new Promise<() => void>(() => {}));

    const { container } = renderApp();

    expect(container.querySelector('.mantine-Loader-root')).toBeInTheDocument();
    expect(screen.queryByTestId('auth-landing')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument();
  });

  it('shows AuthLanding when no access token', async () => {
    await act(async () => {
      renderApp();
    });

    await waitFor(() => {
      expect(screen.getByTestId('auth-landing')).toBeInTheDocument();
    });
  });

  it('renders the app shell when authenticated', async () => {
    (authSession.initAuthSession as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      (authSession.getAccessToken as ReturnType<typeof vi.fn>).mockReturnValue('tok-123');
      (authSession.getSessionUser as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'u1',
        email: 'a@b.com',
        display_name: 'Test',
      });
    });
    (authSession.getAccessToken as ReturnType<typeof vi.fn>).mockReturnValue('tok-123');

    renderApp();

    expect(await screen.findByTestId('app-shell')).toBeInTheDocument();
    expect(screen.getByTestId('page-providers')).toBeInTheDocument();
  });

  it('has navigation items for key sections', async () => {
    (authSession.initAuthSession as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      (authSession.getAccessToken as ReturnType<typeof vi.fn>).mockReturnValue('tok-123');
    });
    (authSession.getAccessToken as ReturnType<typeof vi.fn>).mockReturnValue('tok-123');

    renderApp();

    expect(await screen.findByTestId('app-shell')).toBeInTheDocument();
    expect(screen.getByTestId('shell-nav')).toBeInTheDocument();
  });
});
