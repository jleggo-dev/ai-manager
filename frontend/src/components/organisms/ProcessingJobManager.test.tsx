import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import ProcessingJobManager from './ProcessingJobManager';
import * as api from '../../services/api';

vi.mock('../../services/api', () => ({
  listProcessingJobs: vi.fn(),
  listProcessingJobGroups: vi.fn(),
  listAiProfiles: vi.fn(),
  listFormattingRules: vi.fn(),
  listCallingApplications: vi.fn(),
  getProcessingJob: vi.fn(),
  updateProcessingJob: vi.fn(),
  createProcessingJob: vi.fn(),
  deleteProcessingJob: vi.fn(),
  createCallingApplication: vi.fn(),
  batchUpdateProcessingJobs: vi.fn(),
  updateCallingApplication: vi.fn(),
  createProcessingJobGroup: vi.fn(),
  updateProcessingJobGroup: vi.fn(),
  deleteProcessingJobGroup: vi.fn(),
  testProcessingJob: vi.fn(),
  listDiagnosticLogs: vi.fn(),
  clearDiagnosticLogs: vi.fn(),
}));

vi.mock('../../hooks/useConfirm', () => ({
  default: () => vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@mantine/notifications', () => ({
  notifications: { show: vi.fn() },
}));

const paginated = <T,>(data: T[]) => ({
  data,
  pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 25 },
});

const mockProvider = { id: 'prov-1', name: 'Devs.ai Corp', type: 'devs-ai' };

const mockAiProfile = {
  id: 'profile-1',
  name: 'Company Profiler',
  mode: 'completion',
  is_active: true,
  is_default: true,
  provider: mockProvider,
};

const expectedSchema = {
  fields: {
    company_name: { type: 'string', required: true, description: 'Company name' },
    industry: { type: 'string', required: false, description: 'Industry' },
  },
};

const baseJobConfig = {
  systemPrompt: 'You are a company research assistant.',
  promptTemplate: 'Research {{name}} and return JSON.',
  variables: [{ name: 'name', label: 'Company Name', source: 'user' }],
  testData: { name: 'Acme Corp' },
  expectedSchema,
  formattingRules: [],
  advanced: { diagnostics: { enabled: true, mode: 'always' }, timeout: {}, retries: {}, caching: {} },
  analytics: { contentFields: ['company_name', 'industry'] },
};

const mockJob = {
  id: 'job-1',
  name: 'Company Profiling',
  slug: 'company-profiling',
  description: 'Profiles a company from its name',
  ai_profile_id: 'profile-1',
  ai_profile: mockAiProfile,
  is_active: true,
  calling_application_id: 'app-1',
  config: baseJobConfig,
  workspace_id: 'ws-1',
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
};

const mockCallingApp = {
  id: 'app-1',
  display_name: 'app-1',
  workspace_id: 'ws-1',
  created_at: '2024-01-01T00:00:00Z',
};

function renderComponent() {
  return render(
    <MantineProvider>
      <ProcessingJobManager />
    </MantineProvider>,
  );
}

/** Select job-1 from the Jobs tab (list/table view) and wait for its full detail to load. */
async function selectJob() {
  const cell = await screen.findByText('Company Profiling');
  fireEvent.click(cell);
  await waitFor(() => {
    expect(api.getProcessingJob).toHaveBeenCalledWith('job-1');
  });
  // Wait for the tab bar to unlock (job-dependent tabs become enabled once selectedJobFull loads).
  await waitFor(() => {
    expect(screen.getByRole('tab', { name: /Build Rules/i })).not.toHaveAttribute('data-disabled', 'true');
  });
}

function goToTab(name: RegExp) {
  fireEvent.click(screen.getByRole('tab', { name }));
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.listProcessingJobs as ReturnType<typeof vi.fn>).mockResolvedValue(paginated([mockJob]));
  (api.listProcessingJobGroups as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (api.listAiProfiles as ReturnType<typeof vi.fn>).mockResolvedValue(paginated([mockAiProfile]));
  (api.listFormattingRules as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (api.listCallingApplications as ReturnType<typeof vi.fn>).mockResolvedValue(paginated([mockCallingApp]));
  (api.getProcessingJob as ReturnType<typeof vi.fn>).mockResolvedValue(mockJob);
  (api.listDiagnosticLogs as ReturnType<typeof vi.fn>).mockResolvedValue(paginated([]));
  (api.updateProcessingJob as ReturnType<typeof vi.fn>).mockResolvedValue(mockJob);
  (api.createProcessingJob as ReturnType<typeof vi.fn>).mockResolvedValue(mockJob);
  (api.deleteProcessingJob as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (api.testProcessingJob as ReturnType<typeof vi.fn>).mockResolvedValue({});
});

describe('ProcessingJobManager', () => {
  it('renders without crashing and loads the jobs list', async () => {
    renderComponent();
    await waitFor(() => {
      expect(api.listProcessingJobs).toHaveBeenCalled();
    });
    expect(await screen.findByText('Company Profiling')).toBeInTheDocument();
  });

  describe('(a) create / edit / delete a job', () => {
    it('creates a new job via the modal form', async () => {
      renderComponent();
      await screen.findByText('Company Profiling');

      fireEvent.click(screen.getByRole('button', { name: /Add Processing Job/i }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByPlaceholderText('e.g. Company Profiling'), {
        target: { value: 'New Job' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

      await waitFor(() => {
        expect(api.createProcessingJob).toHaveBeenCalledWith(expect.objectContaining({ name: 'New Job' }));
      });
    });

    it('edits an existing job via the modal form', async () => {
      renderComponent();
      await screen.findByText('Company Profiling');

      const menuButtons = screen.getAllByRole('button', { name: '' });
      const dotsButton = menuButtons.find((btn) => btn.querySelector('.tabler-icon-dots-vertical'));
      expect(dotsButton).toBeTruthy();
      fireEvent.click(dotsButton as HTMLElement);
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));

      const dialog = await screen.findByRole('dialog');
      const nameInput = within(dialog).getByPlaceholderText('e.g. Company Profiling') as HTMLInputElement;
      expect(nameInput.value).toBe('Company Profiling');
      fireEvent.change(nameInput, { target: { value: 'Company Profiling v2' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Update' }));

      await waitFor(() => {
        expect(api.updateProcessingJob).toHaveBeenCalledWith(
          'job-1',
          expect.objectContaining({ name: 'Company Profiling v2' }),
        );
      });
    });

    it('deletes a job after typing the confirmation phrase', async () => {
      renderComponent();
      await screen.findByText('Company Profiling');

      const menuButtons = screen.getAllByRole('button', { name: '' });
      const dotsButton = menuButtons.find((btn) => btn.querySelector('.tabler-icon-dots-vertical'));
      fireEvent.click(dotsButton as HTMLElement);
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));

      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByPlaceholderText('delete'), { target: { value: 'delete' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete Job' }));

      await waitFor(() => {
        expect(api.deleteProcessingJob).toHaveBeenCalledWith('job-1');
      });
    });
  });

  describe('(b) build-rules prompt composition', () => {
    it('saves the edited prompt template and formatting rules', async () => {
      renderComponent();
      await selectJob();
      goToTab(/Build Rules/i);

      const promptField = await screen.findByLabelText('Prompt Template');
      fireEvent.change(promptField, { target: { value: 'Research {{name}} thoroughly and return JSON.' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save All Changes' }));

      await waitFor(() => {
        expect(api.updateProcessingJob).toHaveBeenCalledWith(
          'job-1',
          expect.objectContaining({
            config: expect.objectContaining({ promptTemplate: 'Research {{name}} thoroughly and return JSON.' }),
          }),
        );
      });
    });
  });

  describe('(c) test-tab request/render cycle', () => {
    it('composes the prompt, runs the test, and renders raw + formatted output', async () => {
      (api.testProcessingJob as ReturnType<typeof vi.fn>).mockResolvedValue({
        raw: '{"company_name":"Acme Corp","industry":"Tech"}',
        formatted: '{"company_name":"Acme Corp","industry":"Tech"}',
        durationMs: 120,
        model: 'gpt-4',
        usage: { prompt_tokens: 10, completion_tokens: 5 },
        finishReason: 'stop',
        formattingSteps: [],
      });

      renderComponent();
      await selectJob();
      goToTab(/Test Rules/i);

      fireEvent.click(await screen.findByRole('button', { name: /Generate Test Values/i }));
      fireEvent.click(screen.getByRole('button', { name: /Run Test/i }));

      await waitFor(() => {
        expect(api.testProcessingJob).toHaveBeenCalledWith(
          'job-1',
          expect.objectContaining({ name: 'Acme Corp' }),
          expect.stringContaining('Acme Corp'),
        );
      });

      expect(await screen.findByText('Raw Response')).toBeInTheDocument();
      expect(screen.getByText('Formatted Response')).toBeInTheDocument();
    });
  });

  describe('(d) schema-validation pass/fail rendering', () => {
    it('renders "Valid" when the response satisfies the expected schema', async () => {
      (api.testProcessingJob as ReturnType<typeof vi.fn>).mockResolvedValue({
        raw: '{"company_name":"Acme Corp","industry":"Tech"}',
        formatted: '{"company_name":"Acme Corp","industry":"Tech"}',
        durationMs: 120,
        model: 'gpt-4',
        finishReason: 'stop',
      });

      renderComponent();
      await selectJob();
      goToTab(/Test Rules/i);
      fireEvent.click(await screen.findByRole('button', { name: /Generate Test Values/i }));
      fireEvent.click(screen.getByRole('button', { name: /Run Test/i }));

      expect(await screen.findByText('Schema Validation')).toBeInTheDocument();
      expect(screen.getByText('Valid')).toBeInTheDocument();
    });

    it('renders a parse-error state when the response is not valid JSON', async () => {
      (api.testProcessingJob as ReturnType<typeof vi.fn>).mockResolvedValue({
        raw: 'not json',
        formatted: 'not json',
        durationMs: 120,
        model: 'gpt-4',
        finishReason: 'stop',
      });

      renderComponent();
      await selectJob();
      goToTab(/Test Rules/i);
      fireEvent.click(await screen.findByRole('button', { name: /Generate Test Values/i }));
      fireEvent.click(screen.getByRole('button', { name: /Run Test/i }));

      expect(await screen.findByText('Schema Validation')).toBeInTheDocument();
      expect(screen.getByText('JSON Parse Error')).toBeInTheDocument();
    });
  });

  describe('(e) analytics field-scoring toggle + save', () => {
    it('toggles a field out of content scoring and saves the selection', async () => {
      (api.listDiagnosticLogs as ReturnType<typeof vi.fn>).mockResolvedValue(
        paginated([
          {
            id: 'log-1',
            status: 'success',
            total_duration_ms: 500,
            llm_timing: { durationMs: 400, model: 'gpt-4', provider: 'devs-ai' },
            llm_response: {
              rawContent: '{"company_name":"Acme Corp"}',
              finishReason: 'stop',
              usage: { prompt_tokens: 10, completion_tokens: 5 },
            },
          },
        ]),
      );

      renderComponent();
      await selectJob();
      goToTab(/Analytics/i);

      await screen.findByText('Field Coverage Breakdown');
      const industryCheckbox = screen.getByLabelText('Include industry in content score');
      fireEvent.click(industryCheckbox);
      fireEvent.click(screen.getByRole('button', { name: 'Save Selection' }));

      await waitFor(() => {
        expect(api.updateProcessingJob).toHaveBeenCalledWith(
          'job-1',
          expect.objectContaining({
            config: expect.objectContaining({
              analytics: expect.objectContaining({ contentFields: ['company_name'] }),
            }),
          }),
        );
      });
    });
  });
});
