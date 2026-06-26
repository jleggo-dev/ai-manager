import { useState, useCallback, useEffect, ComponentType } from 'react';
import { Select, Group, Center, Loader } from '@mantine/core';
import AppShellLayout from './layouts/AppShell';
import type { AppMode } from './layouts/AppShell';
import AuthLanding from './components/auth/AuthLanding';

import ProvidersPage from './pages/ProvidersPage';
import AiProfilesPage from './pages/AiProfilesPage';
import ProcessingJobsPage from './pages/ProcessingJobsPage';
import AiMatcherPage from './pages/AiMatcherPage';
import SettingsPage from './pages/SettingsPage';
import TeamPage from './pages/TeamPage';
import LovableGuidePage from './pages/LovableGuidePage';
import WorkflowsPage from './pages/WorkflowsPage';
import WorkflowEditorPage from './pages/WorkflowEditorPage';
import WorkflowDetailPage from './pages/WorkflowDetailPage';
import HealthDashboardPage from './pages/HealthDashboardPage';
import HealthCheckProvidersPage from './pages/HealthCheckProvidersPage';
import HealthCheckProfilesPage from './pages/HealthCheckProfilesPage';
import HealthCheckConfigPage from './pages/HealthCheckConfigPage';
import HealthCheckWidgetPage from './pages/HealthCheckWidgetPage';

import {
  initAuthSession,
  signOut,
  getAccessToken,
  getSessionUser,
  setWorkspaceId,
  getWorkspaceId,
} from './lib/auth-session';
import type { SessionUser } from './lib/auth-session';
import { isAdminRole } from './lib/roles';
import { listWorkspaces } from './services/api';
import type { WorkspaceMembership } from './types/api';

type NavigateFn = (key: string, params?: Record<string, unknown>) => void;

interface PageComponentProps {
  onNavigate: NavigateFn;
  pageParams: Record<string, unknown>;
  workspaceRole?: string | null;
}

const PAGES: Record<string, ComponentType<PageComponentProps>> = {
  providers: ProvidersPage,
  'ai-profiles': AiProfilesPage,
  'processing-jobs': ProcessingJobsPage,
  'ai-matcher': AiMatcherPage,
  workflows: WorkflowsPage,
  'workflow-detail': WorkflowDetailPage,
  'workflow-editor': WorkflowEditorPage,
  team: TeamPage,
  settings: SettingsPage,
  lovable: LovableGuidePage,
  'hc-dashboard': HealthDashboardPage,
  'hc-providers': HealthCheckProvidersPage,
  'hc-profiles': HealthCheckProfilesPage,
  'hc-checks': HealthCheckConfigPage,
  'hc-widget-checks': HealthCheckWidgetPage,
};

const DEFAULT_PAGE: Record<AppMode, string> = {
  admin: 'providers',
  'health-checker': 'hc-dashboard',
};

interface WorkspaceToolbarProps {
  workspaceOptions: { value: string; label: string }[];
  onWorkspaceChange: (id: string) => void;
}

function WorkspaceToolbar({ workspaceOptions, onWorkspaceChange }: WorkspaceToolbarProps) {
  const current = getWorkspaceId();
  if (!workspaceOptions?.length || workspaceOptions.length <= 1) return null;

  return (
    <Group justify="flex-end" mb="md">
      <Select
        label="Workspace"
        size="xs"
        w={300}
        data={workspaceOptions}
        value={current || null}
        onChange={(v) => {
          if (v) onWorkspaceChange(v);
        }}
      />
    </Group>
  );
}

function initialModeFromUrl(): { mode: AppMode; page: string } {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode') === 'health-checker' ? 'health-checker' : 'admin';
  const page = params.get('page') || DEFAULT_PAGE[mode];
  return { mode, page };
}

export default function App() {
  const initial = initialModeFromUrl();
  const [activePage, setActivePage] = useState(initial.page);
  const [pageParams, setPageParams] = useState<Record<string, unknown>>({});
  const [navKey, setNavKey] = useState(0);
  const [authReady, setAuthReady] = useState(false);
  const [sessionTick, setSessionTick] = useState(0);
  const [workspaceOpts, setWorkspaceOpts] = useState<{ value: string; label: string }[]>([]);
  const [workspaceSummaries, setWorkspaceSummaries] = useState<WorkspaceMembership[]>([]);
  const [sessionUserProfile, setSessionUserProfile] = useState<SessionUser | null>(null);
  const [appMode, setAppMode] = useState<AppMode>(initial.mode);

  const loadWorkspaceOptions = useCallback(async () => {
    if (!getAccessToken()) {
      setWorkspaceOpts([]);
      setWorkspaceSummaries([]);
      return;
    }
    try {
      const { workspaces } = await listWorkspaces();
      const list = workspaces || [];
      setWorkspaceSummaries(list);
      setWorkspaceOpts(
        list.map((w) => ({
          value: w.workspace_id,
          label: w.workspace?.name || w.workspace?.slug || w.workspace_id,
        })),
      );
      if (list.length === 1) {
        const onlyId = list[0]?.workspace_id;
        if (!onlyId) return;
        if (getWorkspaceId() !== onlyId) setWorkspaceId(onlyId);
      }
    } catch {
      setWorkspaceOpts([]);
      setWorkspaceSummaries([]);
    }
  }, []);

  useEffect(() => {
    initAuthSession()
      .then(() => {
        setSessionUserProfile(getSessionUser());
        return loadWorkspaceOptions();
      })
      .finally(() => setAuthReady(true));
  }, [loadWorkspaceOptions]);

  const navigate: NavigateFn = useCallback((key, params = {}) => {
    setNavKey((k) => k + 1);
    setActivePage(key);
    setPageParams(params);
    window.scrollTo(0, 0);
  }, []);

  const handleSignOut = useCallback(async () => {
    await signOut();
    setWorkspaceOpts([]);
    setWorkspaceSummaries([]);
    setSessionUserProfile(null);
    setSessionTick((t) => t + 1);
  }, []);

  const currentWorkspaceId = getWorkspaceId();
  const currentWorkspaceRole = workspaceSummaries.find((w) => w.workspace_id === currentWorkspaceId)?.role;
  const adminUser = isAdminRole(currentWorkspaceRole);

  const handleToggleMode = useCallback(() => {
    setAppMode((prev) => {
      const next: AppMode = prev === 'admin' ? 'health-checker' : 'admin';
      setActivePage(DEFAULT_PAGE[next]);
      setPageParams({});
      setNavKey((k) => k + 1);
      window.scrollTo(0, 0);
      return next;
    });
  }, []);

  const ActiveComponent = PAGES[activePage] || ProvidersPage;

  if (!authReady) {
    return (
      <Center h="100vh">
        <Loader size="lg" />
      </Center>
    );
  }

  if (!getAccessToken()) {
    return <AuthLanding />;
  }

  return (
    <AppShellLayout
      activePage={activePage}
      onNavigate={navigate}
      onSignOut={handleSignOut}
      sessionUser={sessionUserProfile}
      appMode={appMode}
      onToggleMode={handleToggleMode}
      isAdmin={adminUser}
    >
      <WorkspaceToolbar
        workspaceOptions={workspaceOpts}
        onWorkspaceChange={(id) => {
          setWorkspaceId(id);
          setNavKey((k) => k + 1);
        }}
      />
      <ActiveComponent
        key={`${activePage}-${navKey}-${sessionTick}-${getWorkspaceId()}`}
        onNavigate={navigate}
        pageParams={pageParams}
        workspaceRole={currentWorkspaceRole}
      />
    </AppShellLayout>
  );
}
