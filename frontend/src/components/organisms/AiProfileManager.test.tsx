import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import AiProfileManager from './AiProfileManager';
import * as api from '../../services/api';

/* jsdom doesn't implement scrollTo; TestChatPanel's auto-scroll effect needs a no-op. */
Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;

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
  createChatSession: vi.fn(),
  sendChatMessageStream: vi.fn(),
  submitChatToolOutputs: vi.fn(),
  closeChatSession: vi.fn(() => Promise.resolve()),
  resetChatSession: vi.fn(() => Promise.resolve()),
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

/**
 * Builds a fake `Response` whose `body.getReader()` replays the given raw
 * SSE text as a single chunk, matching the shape `TestChatPanel.processStream`
 * expects from `api.sendChatMessageStream` / `api.submitChatToolOutputs`.
 */
function makeSseResponse(sseText: string, ok = true) {
  let delivered = false;
  const reader = {
    read: async () => {
      if (!delivered) {
        delivered = true;
        return { value: new TextEncoder().encode(sseText), done: false };
      }
      return { value: undefined, done: true };
    },
    cancel: async () => {},
  };
  return {
    ok,
    status: ok ? 200 : 500,
    body: { getReader: () => reader },
    json: async () => ({}),
  } as unknown as Response;
}

/** Opens the "Test chat" drawer for the row with the given profile name. */
async function openTestChatFor(profileName: string) {
  const row = screen.getByText(profileName).closest('tr') as HTMLElement;
  expect(row).toBeTruthy();
  const trigger = row.querySelector('.tabler-icon-dots-vertical')?.closest('button') as HTMLElement;
  expect(trigger).toBeTruthy();
  fireEvent.click(trigger);
  const testChatItem = await screen.findByText('Test chat');
  fireEvent.click(testChatItem);
  await screen.findByText(`Chat with ${profileName}`);
}

function getChatInput() {
  return screen.getByPlaceholderText('Type your message to test the AI response formatting...');
}

function getSendButton() {
  return document.querySelector('.tabler-icon-send')?.closest('button') as HTMLElement;
}

describe('AiProfileManager > TestChatPanel streaming', () => {
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

  it('streams an assistant reply for a chat-mode profile (happy path)', async () => {
    (api.createChatSession as ReturnType<typeof vi.fn>).mockResolvedValue({ sessionId: 'sess-1' });
    (api.sendChatMessageStream as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSseResponse('data: {"choices":[{"delta":{"content":"Hello world"}}]}\n\ndata: [DONE]\n\n'),
    );

    renderComponent();
    await screen.findByText('Gemini Model');
    await openTestChatFor('Gemini Model');

    fireEvent.change(getChatInput(), { target: { value: 'Hello AI' } });
    fireEvent.click(getSendButton());

    await waitFor(() => {
      expect(api.createChatSession).toHaveBeenCalledWith(
        expect.objectContaining({ aiProfileId: 'prof-2', userId: 'user-1' }),
      );
    });
    await waitFor(() => {
      expect(api.sendChatMessageStream).toHaveBeenCalledWith('sess-1', 'Hello AI');
    });

    expect(await screen.findByText('Hello world')).toBeInTheDocument();
    expect(screen.getByText('Hello AI')).toBeInTheDocument();
  });

  it('surfaces a tool-auth-required prompt and resumes the stream after authorization', async () => {
    (api.createChatSession as ReturnType<typeof vi.fn>).mockResolvedValue({ sessionId: 'sess-2' });
    (api.sendChatMessageStream as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSseResponse(
        [
          'data: {"type":"tool.call","messageId":"m1","calls":[{"id":"call-1","type":"mcp__gmail__send","arguments":{"requiresUserAction":true}}]}',
          'data: {"type":"tool.message","toolCallId":"call-1","status":"pending","output":"Needs authorization","messageId":"m1","metadata":{"requiresUserAction":true,"authUrl":"https://oauth.example.com/authorize"}}',
          'data: [DONE]',
          '',
        ].join('\n\n'),
      ),
    );
    (api.submitChatToolOutputs as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSseResponse('data: {"choices":[{"delta":{"content":"Thanks, continuing."}}]}\n\ndata: [DONE]\n\n'),
    );

    renderComponent();
    await screen.findByText('Gemini Model');
    await openTestChatFor('Gemini Model');

    fireEvent.change(getChatInput(), { target: { value: 'send the email' } });
    fireEvent.click(getSendButton());

    expect(await screen.findByText('send')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
    const authorizeBtn = await screen.findByRole('button', { name: /Authorize/i });
    const resumeBtn = screen.getByRole('button', { name: /Resume after auth/i });
    expect(authorizeBtn).toBeInTheDocument();

    fireEvent.click(resumeBtn);

    await waitFor(() => {
      expect(api.submitChatToolOutputs).toHaveBeenCalledWith('sess-2', 'm1', [
        { toolCallId: 'call-1', output: 'OAuth authorization completed by user.' },
      ]);
    });
    expect(await screen.findByText('Thanks, continuing.')).toBeInTheDocument();
  });
});

describe('AiProfileManager > bulk selection (list view checkboxes)', () => {
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

  it('tracks individual row selection and reflects it in the select-all checkbox', async () => {
    renderComponent();
    await screen.findByText('Claude Agent');

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(3);
    const [selectAll, rowClaude, rowGemini] = checkboxes as [HTMLElement, HTMLElement, HTMLElement];

    expect(selectAll).not.toBeChecked();
    fireEvent.click(rowClaude);
    expect(rowClaude).toBeChecked();
    expect(rowGemini).not.toBeChecked();
    expect(selectAll).not.toBeChecked();
  });

  it('select-all checkbox selects and clears every visible row', async () => {
    renderComponent();
    await screen.findByText('Claude Agent');

    const [selectAll, rowClaude, rowGemini] = screen.getAllByRole('checkbox') as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];

    fireEvent.click(selectAll);
    expect(rowClaude).toBeChecked();
    expect(rowGemini).toBeChecked();

    fireEvent.click(selectAll);
    expect(rowClaude).not.toBeChecked();
    expect(rowGemini).not.toBeChecked();
  });

  it('deselecting one row after select-all leaves the rest checked', async () => {
    renderComponent();
    await screen.findByText('Claude Agent');

    const [, rowClaude, rowGemini] = screen.getAllByRole('checkbox') as [HTMLElement, HTMLElement, HTMLElement];
    fireEvent.click(rowClaude);
    fireEvent.click(rowGemini);
    expect(rowClaude).toBeChecked();
    expect(rowGemini).toBeChecked();

    fireEvent.click(rowClaude);
    expect(rowClaude).not.toBeChecked();
    expect(rowGemini).toBeChecked();
  });
});
