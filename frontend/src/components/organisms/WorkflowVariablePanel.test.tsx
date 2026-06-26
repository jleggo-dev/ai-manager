import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import WorkflowVariablePanel from './WorkflowVariablePanel';
import * as api from '../../services/api';

vi.mock('../../services/api', () => ({
  getProcessingJob: vi.fn(),
}));

const mockJob = {
  id: 'job-1',
  name: 'Zhuzh Content',
  slug: 'breakout-zhuzh',
  is_active: true,
  workspace_id: 'ws-1',
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
  config: {
    promptTemplate: 'Title: {{current_title}}\nAudience: {{target_audiences}}',
    variables: [
      { name: 'current_title', label: 'Current title', source: 'user' },
      { name: 'target_audiences', label: 'Target audiences', source: 'user' },
    ],
    expectedSchema: {
      fields: { title: { type: 'string' }, description: { type: 'string' } },
    },
    testData: {
      current_title: 'Building AI Agents',
      target_audiences: 'Engineers',
    },
  },
};

function renderPanel(
  steps = [{ step_key: 'step-1', name: 'Generate Content', processing_job_id: 'job-1', sort_order: 0 }],
  inputVars = [{ name: 'topic', label: 'Topic', required: true }],
) {
  return render(
    <MantineProvider>
      <WorkflowVariablePanel steps={steps} inputVariables={inputVars} />
    </MantineProvider>,
  );
}

describe('WorkflowVariablePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getProcessingJob as ReturnType<typeof vi.fn>).mockResolvedValue(mockJob);
  });

  it('renders loading state initially', () => {
    (api.getProcessingJob as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    const { container } = renderPanel();
    expect(container.querySelector('.mantine-Loader-root')).toBeInTheDocument();
  });

  it('shows empty state when no steps provided', () => {
    renderPanel([], []);
    expect(screen.getByText(/Add steps with processing jobs/)).toBeInTheDocument();
  });

  it('shows Variable Pipeline heading after loading', async () => {
    renderPanel();
    expect(await screen.findByText('Variable Pipeline')).toBeInTheDocument();
  });

  it('displays workflow input variables', async () => {
    renderPanel();
    await waitFor(() => expect(api.getProcessingJob).toHaveBeenCalled());
    const topicElements = await screen.findAllByText(/topic/);
    expect(topicElements.length).toBeGreaterThan(0);
  });

  it('shows step names in the pipeline', async () => {
    renderPanel();
    const elements = await screen.findAllByText('Generate Content');
    expect(elements.length).toBeGreaterThan(0);
  });

  it('shows variable count badge', async () => {
    renderPanel();
    const badges = await screen.findAllByText(/variable/);
    expect(badges.length).toBeGreaterThan(0);
  });

  it('renders All Variables table', async () => {
    renderPanel();
    expect(await screen.findByText('All Variables')).toBeInTheDocument();
  });

  it('shows input mapping info when step has config', async () => {
    const stepsWithMappings = [
      {
        step_key: 'step-1',
        name: 'Generate Content',
        processing_job_id: 'job-1',
        sort_order: 0,
        config: {
          inputMappings: { current_title: 'topic' },
          outputMappings: { title: 'generated_title' },
        },
      },
    ];
    renderPanel(stepsWithMappings);
    await waitFor(() => expect(api.getProcessingJob).toHaveBeenCalled());
    const inBadges = await screen.findAllByText(/in$/);
    expect(inBadges.length).toBeGreaterThan(0);
    const outBadges = screen.getAllByText(/out$/);
    expect(outBadges.length).toBeGreaterThan(0);
  });

  it('deduplicates job fetches for steps sharing the same job', async () => {
    const twoStepsSameJob = [
      { step_key: 's1', name: 'Step 1', processing_job_id: 'job-1', sort_order: 0 },
      { step_key: 's2', name: 'Step 2', processing_job_id: 'job-1', sort_order: 1 },
    ];
    renderPanel(twoStepsSameJob, []);
    await waitFor(() => {
      expect(api.getProcessingJob).toHaveBeenCalledTimes(1);
    });
  });

  it('handles job fetch failure gracefully', async () => {
    (api.getProcessingJob as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Not found'));
    renderPanel([{ step_key: 'step-1', name: 'Step', processing_job_id: 'job-1', sort_order: 0 }], []);
    await waitFor(() => expect(api.getProcessingJob).toHaveBeenCalled());
    expect(await screen.findByText('Variable Pipeline')).toBeInTheDocument();
  });

  it('shows auto-captured prompt and response variables per step', async () => {
    renderPanel([{ step_key: 'analyze', name: 'Analyze', processing_job_id: 'job-1', sort_order: 0 }], []);
    await waitFor(() => expect(api.getProcessingJob).toHaveBeenCalled());
    await waitFor(() => {
      const el = document.body.innerHTML;
      expect(el).toContain('analyze.prompt');
      expect(el).toContain('analyze.response');
    });
  });

  it('labels auto-captured variables with auto: source', async () => {
    renderPanel([{ step_key: 'generate', name: 'Generate', processing_job_id: 'job-1', sort_order: 0 }], []);
    await waitFor(() => expect(api.getProcessingJob).toHaveBeenCalled());
    const autoBadges = await screen.findAllByText(/^auto: Generate$/);
    expect(autoBadges.length).toBeGreaterThan(0);
  });

  it('includes help text describing the variable pipeline', async () => {
    renderPanel();
    await waitFor(() => expect(api.getProcessingJob).toHaveBeenCalled());
    expect(await screen.findByText(/Variables flow through the workflow/)).toBeInTheDocument();
  });
});
