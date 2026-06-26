import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import WorkflowTestSimulator from './WorkflowTestSimulator';
import * as api from '../../services/api';
import type { Workflow } from '../../types/api';

vi.mock('../../services/api', () => ({
  getProcessingJob: vi.fn(),
  createChatSession: vi.fn(),
}));

vi.mock('@mantine/notifications', () => ({
  notifications: { show: vi.fn() },
}));

const mockJob = {
  id: 'job-1',
  name: 'Test Job',
  slug: 'test-job',
  is_active: true,
  workspace_id: 'ws-1',
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
  config: {
    promptTemplate: 'Hello {{name}}, your role is {{role}}.',
    variables: [
      { name: 'name', label: 'User Name', source: 'user' },
      { name: 'role', label: 'Role', source: 'user' },
    ],
    testData: {
      name: 'Alice',
      role: 'Engineer',
    },
  },
};

const mockWorkflow = {
  id: 'wf-1',
  name: 'Test Workflow',
  slug: 'test-workflow',
  description: 'A test workflow',
  ai_profile_id: 'prof-1',
  is_active: true,
  workspace_id: 'ws-1',
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
  steps: [
    {
      id: 'step-1',
      step_key: 'greet',
      name: 'Greet User',
      processing_job_id: 'job-1',
      sort_order: 0,
      depends_on: [],
    },
  ],
} as Workflow & {
  steps: Array<{
    id: string;
    step_key: string;
    name: string;
    processing_job_id: string;
    sort_order: number;
    depends_on: string[];
  }>;
};

function renderSimulator() {
  const closeFn = vi.fn();
  const result = render(
    <MantineProvider>
      <WorkflowTestSimulator workflow={mockWorkflow} onClose={closeFn} />
    </MantineProvider>,
  );
  return { ...result, closeFn };
}

describe('WorkflowTestSimulator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getProcessingJob as ReturnType<typeof vi.fn>).mockResolvedValue(mockJob);
  });

  it('renders loading then shows workflow name', async () => {
    renderSimulator();
    expect(await screen.findByText(/Test: Test Workflow/)).toBeInTheDocument();
  });

  it('displays dry run mode by default', async () => {
    renderSimulator();
    await waitFor(() => {
      expect(api.getProcessingJob).toHaveBeenCalledWith('job-1');
    });
    expect(screen.getByText('Dry Run')).toBeInTheDocument();
  });

  it('shows step with name and key', async () => {
    renderSimulator();
    expect(await screen.findByText(/Greet User/)).toBeInTheDocument();
    expect(screen.getByText('greet')).toBeInTheDocument();
  });

  it('pre-fills variables from job test data', async () => {
    renderSimulator();
    await waitFor(() => {
      expect(api.getProcessingJob).toHaveBeenCalled();
    });
    const nameInput = await screen.findByDisplayValue('Alice');
    expect(nameInput).toBeInTheDocument();
    const roleInput = screen.getByDisplayValue('Engineer');
    expect(roleInput).toBeInTheDocument();
  });

  it('shows interpolated prompt with test data', async () => {
    renderSimulator();
    expect(await screen.findByText(/Hello Alice, your role is Engineer\./)).toBeInTheDocument();
  });

  it('updates interpolated prompt when variable changes', async () => {
    const user = userEvent.setup();
    renderSimulator();
    const nameInput = await screen.findByDisplayValue('Alice');
    await user.clear(nameInput);
    await user.type(nameInput, 'Bob');
    expect(await screen.findByText(/Hello Bob, your role is Engineer\./)).toBeInTheDocument();
  });

  it('has Reset button', async () => {
    renderSimulator();
    expect(await screen.findByRole('button', { name: /Reset/ })).toBeInTheDocument();
  });

  it('has Close button that calls onClose', async () => {
    const user = userEvent.setup();
    const { closeFn } = renderSimulator();
    const closeBtn = await screen.findByRole('button', { name: /Close/ });
    await user.click(closeBtn);
    expect(closeFn).toHaveBeenCalledTimes(1);
  });

  it('shows live run warning when switching to Live Run', async () => {
    const user = userEvent.setup();
    renderSimulator();
    await screen.findByText(/Test: Test Workflow/);
    const liveBtn = screen.getByText('Live Run');
    await user.click(liveBtn);
    expect(await screen.findByText(/Live Run calls the real LLM/)).toBeInTheDocument();
  });

  it('shows Run All Steps button in live mode', async () => {
    const user = userEvent.setup();
    renderSimulator();
    await screen.findByText(/Test: Test Workflow/);
    const liveBtn = screen.getByText('Live Run');
    await user.click(liveBtn);
    expect(await screen.findByRole('button', { name: /Run All Steps/ })).toBeInTheDocument();
  });

  it('shows job name in step summary', async () => {
    renderSimulator();
    expect(await screen.findByText('Test Job')).toBeInTheDocument();
  });

  it('applies input mappings from step config', async () => {
    const workflowWithMappings = {
      ...mockWorkflow,
      steps: [
        {
          id: 'step-1',
          step_key: 'greet',
          name: 'Greet User',
          processing_job_id: 'job-1',
          sort_order: 0,
          depends_on: [] as string[],
          config: {
            inputMappings: { name: 'wf_user' },
          },
        },
      ],
    };

    render(
      <MantineProvider>
        <WorkflowTestSimulator workflow={workflowWithMappings} onClose={vi.fn()} />
      </MantineProvider>,
    );

    await waitFor(() => expect(api.getProcessingJob).toHaveBeenCalled());
    const inputs = await screen.findAllByDisplayValue('Alice');
    expect(inputs.length).toBeGreaterThan(0);
  });
});
