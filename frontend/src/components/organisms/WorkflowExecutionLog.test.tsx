import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import WorkflowExecutionLog from './WorkflowExecutionLog';
import * as api from '../../services/api';
import type { WorkflowStep } from '../../types/api';

vi.mock('../../services/api', () => ({
  getChatMessages: vi.fn(),
  listDiagnosticLogs: vi.fn(),
}));

const mockSteps: WorkflowStep[] = [
  {
    id: 'step-uuid-1',
    workflow_id: 'wf-1',
    processing_job_id: 'job-1',
    step_key: 'analyze',
    name: 'Analyze Data',
    sort_order: 0,
  },
  {
    id: 'step-uuid-2',
    workflow_id: 'wf-1',
    processing_job_id: 'job-2',
    step_key: 'summarize',
    name: 'Summarize Results',
    sort_order: 1,
  },
];

const mockMessages = [
  {
    id: 'msg-1',
    chat_session_id: 'sess-1',
    role: 'user',
    content: 'Analyze the following data...',
    workflow_step_id: 'step-uuid-1',
    created_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 'msg-2',
    chat_session_id: 'sess-1',
    role: 'assistant',
    content: '{"analysis": "The data shows..."}',
    duration_ms: 1200,
    prompt_tokens: 50,
    completion_tokens: 80,
    created_at: '2025-01-01T00:00:01Z',
  },
  {
    id: 'msg-3',
    chat_session_id: 'sess-1',
    role: 'user',
    content: 'Summarize the analysis...',
    workflow_step_id: 'step-uuid-2',
    created_at: '2025-01-01T00:00:02Z',
  },
  {
    id: 'msg-4',
    chat_session_id: 'sess-1',
    role: 'assistant',
    content: 'The summary is: data indicates growth.',
    duration_ms: 800,
    prompt_tokens: 30,
    completion_tokens: 40,
    created_at: '2025-01-01T00:00:03Z',
  },
];

const mockDiagnostics = {
  data: [
    {
      id: 'diag-1',
      status: 'success',
      total_duration_ms: 1200,
      request_payload: { stepKey: 'analyze', mode: 'workflow-step' },
      llm_timing: { durationMs: 1100, provider: 'gemini', model: 'gemini-pro' },
      metadata: { promptTokens: 50, completionTokens: 80 },
      created_at: '2025-01-01T00:00:01Z',
    },
    {
      id: 'diag-2',
      status: 'success',
      total_duration_ms: 800,
      request_payload: { stepKey: 'summarize', mode: 'workflow-step' },
      llm_timing: { durationMs: 700, provider: 'gemini', model: 'gemini-pro' },
      metadata: { promptTokens: 30, completionTokens: 40 },
      created_at: '2025-01-01T00:00:03Z',
    },
  ],
  pagination: { has_more: false, limit: 100 },
};

function renderLog(sessionId = 'sess-1', steps = mockSteps) {
  return render(
    <MantineProvider>
      <WorkflowExecutionLog sessionId={sessionId} steps={steps} />
    </MantineProvider>,
  );
}

describe('WorkflowExecutionLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getChatMessages as ReturnType<typeof vi.fn>).mockResolvedValue(mockMessages);
    (api.listDiagnosticLogs as ReturnType<typeof vi.fn>).mockResolvedValue(mockDiagnostics);
  });

  it('renders loading state initially', () => {
    (api.getChatMessages as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    (api.listDiagnosticLogs as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    const { container } = renderLog();
    expect(container.querySelector('.mantine-Loader-root')).toBeInTheDocument();
  });

  it('shows Execution Timeline heading after loading', async () => {
    renderLog();
    expect(await screen.findByText('Execution Timeline')).toBeInTheDocument();
  });

  it('displays both step names', async () => {
    renderLog();
    expect(await screen.findByText('Analyze Data')).toBeInTheDocument();
    expect(screen.getByText('Summarize Results')).toBeInTheDocument();
  });

  it('shows step count badge', async () => {
    renderLog();
    expect(await screen.findByText('2 / 2 steps')).toBeInTheDocument();
  });

  it('shows success status badges for each step header', async () => {
    renderLog();
    const badges = await screen.findAllByText('success');
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });

  it('expands a step to show tabs', async () => {
    const user = userEvent.setup();
    renderLog();
    const analyzeButton = await screen.findByText('Analyze Data');
    await user.click(analyzeButton);
    const promptTabs = screen.getAllByText('Prompt');
    expect(promptTabs.length).toBeGreaterThanOrEqual(1);
    const responseTabs = screen.getAllByText('Response');
    expect(responseTabs.length).toBeGreaterThanOrEqual(1);
    const variablesTabs = screen.getAllByText('Variables');
    expect(variablesTabs.length).toBeGreaterThanOrEqual(1);
    const diagnosticsTabs = screen.getAllByText('Diagnostics');
    expect(diagnosticsTabs.length).toBeGreaterThanOrEqual(1);
  });

  it('renders prompt content in DOM for completed step', async () => {
    renderLog();
    await waitFor(() => expect(api.getChatMessages).toHaveBeenCalled());
    const prompts = await screen.findAllByText('Analyze the following data...');
    expect(prompts.length).toBeGreaterThanOrEqual(1);
  });

  it('fetches data with correct session ID', async () => {
    renderLog('my-session-id');
    await waitFor(() => {
      expect(api.getChatMessages).toHaveBeenCalledWith('my-session-id');
      expect(api.listDiagnosticLogs).toHaveBeenCalledWith({ chatSessionId: 'my-session-id', limit: 100 });
    });
  });

  it('shows error state on fetch failure', async () => {
    (api.getChatMessages as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));
    renderLog();
    expect(await screen.findByText('Network error')).toBeInTheDocument();
  });

  it('shows empty state when no steps defined', async () => {
    (api.getChatMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (api.listDiagnosticLogs as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [],
      pagination: { has_more: false, limit: 100 },
    });
    renderLog('sess-1', []);
    expect(await screen.findByText('No step executions found for this session.')).toBeInTheDocument();
  });

  it('shows pending status for steps with no messages', async () => {
    (api.getChatMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (api.listDiagnosticLogs as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [],
      pagination: { has_more: false, limit: 100 },
    });
    renderLog();
    const pendingBadges = await screen.findAllByText('pending');
    expect(pendingBadges.length).toBe(2);
  });
});
