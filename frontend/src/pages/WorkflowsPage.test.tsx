import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import WorkflowsPage from './WorkflowsPage';
import * as api from '../services/api';

vi.mock('../services/api', () => ({
  listWorkflows: vi.fn(),
  listProcessingJobs: vi.fn(),
  listAiProfiles: vi.fn(),
}));

vi.mock('@mantine/notifications', () => ({
  notifications: { show: vi.fn() },
}));

const paginatedEmpty = {
  data: [],
  pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 25 },
};

const mockNavigate = vi.fn();

function renderPage() {
  return render(
    <MantineProvider>
      <WorkflowsPage onNavigate={mockNavigate} pageParams={{}} />
    </MantineProvider>,
  );
}

describe('WorkflowsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.listWorkflows as ReturnType<typeof vi.fn>).mockResolvedValue(paginatedEmpty);
    (api.listProcessingJobs as ReturnType<typeof vi.fn>).mockResolvedValue(paginatedEmpty);
    (api.listAiProfiles as ReturnType<typeof vi.fn>).mockResolvedValue(paginatedEmpty);
  });

  it('renders page title', async () => {
    renderPage();
    expect(await screen.findByText('Workflows')).toBeInTheDocument();
  });

  it('renders page description', async () => {
    renderPage();
    expect(screen.getByText(/Group processing jobs/)).toBeInTheDocument();
  });

  it('has a help button (? icon)', async () => {
    renderPage();
    const helpBtn = screen.getByLabelText('Workflow Guide');
    expect(helpBtn).toBeInTheDocument();
  });

  it('opens help drawer when help button is clicked', async () => {
    const user = userEvent.setup();
    renderPage();
    const helpBtn = screen.getByLabelText('Workflow Guide');
    await user.click(helpBtn);
    expect(await screen.findByText('What is a Workflow?')).toBeInTheDocument();
  });
});
