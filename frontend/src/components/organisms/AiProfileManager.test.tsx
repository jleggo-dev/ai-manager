import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import AiProfileManager from './AiProfileManager';
import * as api from '../../services/api';

vi.mock('../../services/api', () => ({
  listAiProfiles: vi.fn(),
  listProviders: vi.fn(),
  listProviderAis: vi.fn(),
  listProviderModels: vi.fn(),
  createAiProfile: vi.fn(),
  updateAiProfile: vi.fn(),
  deleteAiProfile: vi.fn(),
  setAiProfileDefault: vi.fn(),
  clearAiProfileDefault: vi.fn(),
  testAiProfileChat: vi.fn(),
  listProfileTools: vi.fn(),
  listProfileToolAuthStatus: vi.fn(),
}));

vi.mock('../../hooks/useConfirm', () => ({
  default: () => vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../../lib/auth-session', () => ({
  getSessionUser: vi.fn(() => ({ id: 'user-1', email: 'test@test.com' })),
  getAccessToken: vi.fn(() => null),
  getWorkspaceId: vi.fn(() => 'ws-1'),
}));

vi.mock('../../lib/runtime-options', () => ({
  DEVS_AI_BUILTIN_TOOL_OPTIONS: [],
  DEFAULT_RUNTIME_OPTIONS: {},
  normaliseRuntimeOptions: vi.fn((opts: unknown) => opts || {}),
}));

vi.mock('../molecules/AiProfileCard', () => ({
  default: ({ profile }: { profile: { id: string; name: string } }) => (
    <div data-testid={`profile-card-${profile.id}`}>{profile.name}</div>
  ),
}));

vi.mock('../molecules/FailoverConfigModal', () => ({ default: () => null }));
vi.mock('./ManageLlmsModal', () => ({ default: () => null }));

vi.mock('@mantine/notifications', () => ({
  notifications: { show: vi.fn() },
}));

const paginatedEmpty = {
  data: [],
  pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 25 },
};

const mockProviders = [
  {
    id: 'prov-1',
    name: 'Devs.ai Corp',
    type: 'devs-ai',
    base_url: 'https://devs.ai',
    is_active: true,
    workspace_id: 'ws-1',
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    request_timeout_ms: null,
  },
  {
    id: 'prov-2',
    name: 'Gemini Provider',
    type: 'google-gemini',
    base_url: 'https://generativelanguage.googleapis.com',
    is_active: true,
    workspace_id: 'ws-1',
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    request_timeout_ms: null,
  },
];

const mockProfiles = [
  {
    id: 'prof-1',
    name: 'Claude Agent',
    provider_id: 'prov-1',
    external_ai_id: 'claude-3',
    description: 'Test agent profile',
    is_active: true,
    is_default: true,
    profile_type: 'agent',
    mode: 'completion',
    runtime_options: null,
    workspace_id: 'ws-1',
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    provider: mockProviders[0],
  },
  {
    id: 'prof-2',
    name: 'Gemini Model',
    provider_id: 'prov-2',
    external_ai_id: 'gemini-pro',
    description: 'Gemini model profile',
    is_active: true,
    is_default: false,
    profile_type: 'model',
    mode: 'chat',
    runtime_options: null,
    workspace_id: 'ws-1',
    created_at: '2024-02-01',
    updated_at: '2024-02-01',
    provider: mockProviders[1],
  },
];

function renderComponent() {
  return render(
    <MantineProvider>
      <AiProfileManager />
    </MantineProvider>,
  );
}

describe('AiProfileManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.listAiProfiles as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: mockProfiles,
      pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 25 },
    });
    (api.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: mockProviders,
      pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 25 },
    });
  });

  it('renders without crashing', async () => {
    renderComponent();
    await waitFor(() => {
      expect(api.listAiProfiles).toHaveBeenCalled();
    });
  });

  it('shows loading state initially', () => {
    (api.listAiProfiles as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    (api.listProviders as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    const { container } = renderComponent();
    expect(container.querySelector('.mantine-Loader-root')).toBeInTheDocument();
  });

  it('renders profiles when data is loaded', async () => {
    renderComponent();
    expect(await screen.findByText('Claude Agent')).toBeInTheDocument();
    expect(screen.getByText('Gemini Model')).toBeInTheDocument();
  });

  it('shows empty state with no profiles', async () => {
    (api.listAiProfiles as ReturnType<typeof vi.fn>).mockResolvedValue(paginatedEmpty);
    renderComponent();
    expect(await screen.findByText(/No AI profiles configured/)).toBeInTheDocument();
  });

  it('has "Add AI Profile" button', async () => {
    renderComponent();
    expect(await screen.findByRole('button', { name: /Add AI Profile/i })).toBeInTheDocument();
  });

  it('filters profiles by provider via search', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('2 profiles')).toBeInTheDocument();
    });

    expect(screen.getByText('Claude Agent')).toBeInTheDocument();
    expect(screen.getByText('Gemini Model')).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText('Search profiles...');
    fireEvent.change(searchInput, { target: { value: 'Devs.ai' } });

    await waitFor(() => {
      expect(screen.getByText(/Showing 1 of 2 profiles/)).toBeInTheDocument();
    });

    expect(screen.getByText('Claude Agent')).toBeInTheDocument();
    expect(screen.queryByText('Gemini Model')).not.toBeInTheDocument();
  });
});
