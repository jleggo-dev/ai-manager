import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import WorkflowManager from './WorkflowManager';
import * as api from '../../services/api';

vi.mock('../../services/api', () => ({
  listWorkflows: vi.fn(),
  listProcessingJobs: vi.fn(),
  listAiProfiles: vi.fn(),
  getWorkflow: vi.fn(),
  createWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
  deleteWorkflow: vi.fn(),
}));

vi.mock('@mantine/notifications', () => ({
  notifications: { show: vi.fn() },
}));

const paginatedEmpty = {
  data: [],
  pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 25 },
};

const mockWorkflows = [
  {
    id: 'wf-1',
    name: 'Content Pipeline',
    slug: 'content-pipeline',
    description: 'Creates blog content automatically',
    ai_profile_id: 'prof-1',
    ai_profile: { name: 'Claude Agent' },
    is_active: true,
    steps: [{ id: 's1', step_key: 'draft', name: 'Draft' }],
    workspace_id: 'ws-1',
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
  },
  {
    id: 'wf-2',
    name: 'Data Analysis',
    slug: 'data-analysis',
    description: 'Analyzes datasets and generates reports',
    ai_profile_id: null,
    ai_profile: null,
    is_active: false,
    steps: [],
    workspace_id: 'ws-1',
    created_at: '2024-02-01',
    updated_at: '2024-02-01',
  },
];

function renderComponent(
  props: { onNavigate?: (key: string, params?: Record<string, unknown>) => void; autoTestWorkflowId?: string } = {},
) {
  return render(
    <MantineProvider>
      <WorkflowManager onNavigate={props.onNavigate} autoTestWorkflowId={props.autoTestWorkflowId} />
    </MantineProvider>,
  );
}

describe('WorkflowManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.listWorkflows as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: mockWorkflows,
      pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 25 },
    });
    (api.listProcessingJobs as ReturnType<typeof vi.fn>).mockResolvedValue(paginatedEmpty);
    (api.listAiProfiles as ReturnType<typeof vi.fn>).mockResolvedValue(paginatedEmpty);
  });

  it('renders without crashing', async () => {
    renderComponent();
    await waitFor(() => {
      expect(api.listWorkflows).toHaveBeenCalled();
    });
  });

  it('shows loading state initially', () => {
    (api.listWorkflows as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    (api.listProcessingJobs as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    (api.listAiProfiles as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    const { container } = renderComponent();
    expect(container.querySelector('.mantine-Loader-root')).toBeInTheDocument();
  });

  it('renders workflow list when data is loaded', async () => {
    renderComponent();
    expect(await screen.findByText('Content Pipeline')).toBeInTheDocument();
    expect(screen.getByText('Data Analysis')).toBeInTheDocument();
  });

  it('has "New Workflow" button', async () => {
    renderComponent();
    expect(await screen.findByRole('button', { name: /New Workflow/i })).toBeInTheDocument();
  });

  it('shows workflow names and slugs in list view', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByText('Content Pipeline')).toBeInTheDocument();
      expect(screen.getByText('content-pipeline')).toBeInTheDocument();
      expect(screen.getByText('Data Analysis')).toBeInTheDocument();
      expect(screen.getByText('data-analysis')).toBeInTheDocument();
    });
  });

  it('shows active/inactive badges', async () => {
    renderComponent();
    await screen.findByText('Content Pipeline');
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('shows step count badges', async () => {
    renderComponent();
    await screen.findByText('Content Pipeline');
    const badges = screen.getAllByText('1');
    expect(badges.length).toBeGreaterThan(0);
  });

  it('shows empty state when no workflows exist', async () => {
    (api.listWorkflows as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [],
      pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 25 },
    });
    renderComponent();
    expect(await screen.findByText(/No workflows yet/i)).toBeInTheDocument();
  });

  it('calls onNavigate when New Workflow is clicked', async () => {
    const onNavigate = vi.fn();
    renderComponent({ onNavigate });
    const btn = await screen.findByRole('button', { name: /New Workflow/i });
    fireEvent.click(btn);
    expect(onNavigate).toHaveBeenCalledWith('workflow-editor', {});
  });

  it('opens delete modal when delete action is clicked', async () => {
    const { container } = renderComponent();
    await screen.findByText('Content Pipeline');
    const actionButtons = container.querySelectorAll('button.mantine-ActionIcon-root[data-variant="subtle"]');
    const deleteBtn = Array.from(actionButtons).find((btn) => btn.querySelector('.tabler-icon-trash')) as
      | HTMLElement
      | undefined;
    expect(deleteBtn).toBeTruthy();
    fireEvent.click(deleteBtn as HTMLElement);
    expect(await screen.findByText('Delete Workflow')).toBeInTheDocument();
    expect(screen.getAllByText(/Content Pipeline/).length).toBeGreaterThanOrEqual(2);
  });

  it('calls deleteWorkflow and reloads after confirming delete', async () => {
    (api.deleteWorkflow as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { container } = renderComponent();
    await screen.findByText('Content Pipeline');

    const actionButtons = container.querySelectorAll('button.mantine-ActionIcon-root[data-variant="subtle"]');
    const deleteBtn = Array.from(actionButtons).find((btn) => btn.querySelector('.tabler-icon-trash')) as
      | HTMLElement
      | undefined;
    expect(deleteBtn).toBeTruthy();
    fireEvent.click(deleteBtn as HTMLElement);
    await screen.findByText('Delete Workflow');

    const confirmBtn = screen.getByRole('button', { name: 'Delete' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(api.deleteWorkflow).toHaveBeenCalledWith('wf-1');
    });
  });

  it('shows workflow count', async () => {
    renderComponent();
    expect(await screen.findByText('2 workflows')).toBeInTheDocument();
  });

  it('shows singular count for one workflow', async () => {
    (api.listWorkflows as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [mockWorkflows[0]],
      pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 25 },
    });
    renderComponent();
    expect(await screen.findByText('1 workflow')).toBeInTheDocument();
  });
});
