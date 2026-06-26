import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import StepVariableMapper, { type AvailableVariable } from './StepVariableMapper';
import type { ProcessingJob, WorkflowStepConfig } from '../../types/api';

const mockJobs: ProcessingJob[] = [
  {
    id: 'job-1',
    name: 'Generate Content',
    slug: 'generate-content',
    is_active: true,
    workspace_id: 'ws-1',
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    config: {
      promptTemplate: 'Write about {{topic}}',
      variables: [
        { name: 'topic', label: 'Topic', description: 'The subject matter' },
        { name: 'audience', label: 'Audience', description: 'Target audience' },
      ],
      expectedSchema: {
        fields: {
          title: { type: 'string' },
          body: { type: 'string' },
        },
      },
    },
  },
];

const availableVars: AvailableVariable[] = [
  { name: 'user_topic', source: 'input' },
  { name: 'step1.response', source: 'step: step1' },
];

interface TestStep {
  _uid: string;
  step_key: string;
  name: string;
  processing_job_id: string | null;
  is_required?: boolean;
  depends_on: string[];
  config: WorkflowStepConfig;
}

function makeStep(overrides: Partial<TestStep> = {}): TestStep {
  return {
    _uid: 'uid-step',
    step_key: 'generate',
    name: 'Generate',
    processing_job_id: 'job-1',
    is_required: true,
    depends_on: [],
    config: {},
    ...overrides,
  };
}

function renderMapper(
  overrides: {
    step?: TestStep;
    onUpdate?: (updates: Partial<TestStep>) => void;
    jobs?: ProcessingJob[];
    vars?: AvailableVariable[];
  } = {},
) {
  const onUpdate = overrides.onUpdate ?? vi.fn();
  const step = overrides.step ?? makeStep();
  return {
    onUpdate,
    ...render(
      <MantineProvider>
        <StepVariableMapper
          step={step}
          stepIndex={0}
          jobs={overrides.jobs ?? mockJobs}
          allStepKeys={['generate', 'review']}
          availableVars={overrides.vars ?? availableVars}
          onUpdate={onUpdate}
        />
      </MantineProvider>,
    ),
  };
}

describe('StepVariableMapper', () => {
  it('renders step title with index and name', () => {
    renderMapper();
    expect(screen.getByText(/Step 1.*Generate/)).toBeInTheDocument();
  });

  it('renders step key and name inputs', () => {
    renderMapper();
    expect(screen.getByDisplayValue('generate')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Generate')).toBeInTheDocument();
  });

  it('calls onUpdate when step name changes', () => {
    const { onUpdate } = renderMapper();
    const nameInput = screen.getByDisplayValue('Generate');
    fireEvent.change(nameInput, { target: { value: 'Updated' } });
    expect(onUpdate).toHaveBeenCalledWith({ name: 'Updated' });
  });

  it('shows prompt to select job when no job selected', () => {
    renderMapper({ step: makeStep({ processing_job_id: null }) });
    expect(screen.getByText(/Select a processing job above/i)).toBeInTheDocument();
  });

  it('does not show job prompt when job is selected', () => {
    renderMapper();
    expect(screen.queryByText(/Select a processing job above/i)).not.toBeInTheDocument();
  });

  it('renders Input Mapping section when job has variables', () => {
    renderMapper();
    expect(screen.getByText('Input Mapping')).toBeInTheDocument();
    expect(screen.getByText('Topic')).toBeInTheDocument();
    expect(screen.getByText('Audience')).toBeInTheDocument();
  });

  it('shows available variables panel with correct count', () => {
    renderMapper();
    expect(screen.getByText(/Available at this step \(2\)/)).toBeInTheDocument();
    expect(screen.getByText('user_topic')).toBeInTheDocument();
    expect(screen.getByText('step1.response')).toBeInTheDocument();
  });

  it('shows unmapped badge count when variables not mapped', () => {
    renderMapper();
    expect(screen.getByText('2 unmapped')).toBeInTheDocument();
  });

  it('shows "All mapped" badge when all variables are mapped', () => {
    renderMapper({
      step: makeStep({
        config: { inputMappings: { topic: 'user_topic', audience: 'step1.response' } },
      }),
    });
    expect(screen.getByText('All mapped')).toBeInTheDocument();
  });

  it('renders Job Outputs section when job has expectedSchema', () => {
    renderMapper();
    expect(screen.getByText('Job Outputs')).toBeInTheDocument();
    expect(screen.getByText('title')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('renders output type badges', () => {
    renderMapper();
    const badges = screen.getAllByText('string');
    expect(badges.length).toBe(2);
  });

  it('shows existing output mapping values', () => {
    renderMapper({
      step: makeStep({
        config: { outputMappings: { title: 'gen_title' } },
      }),
    });
    expect(screen.getByDisplayValue('gen_title')).toBeInTheDocument();
  });

  it('calls onUpdate when output mapping text changes', () => {
    const { onUpdate } = renderMapper();
    const outputInputs = screen.getAllByPlaceholderText('e.g. project_timeline');
    const firstInput = outputInputs[0] as HTMLElement;
    fireEvent.change(firstInput, { target: { value: 'my_title' } });
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          outputMappings: expect.objectContaining({ title: 'my_title' }),
        }),
      }),
    );
  });

  it('shows required switch', () => {
    renderMapper();
    expect(screen.getByText('Required')).toBeInTheDocument();
  });

  it('renders empty available vars message when none available', () => {
    renderMapper({ vars: [] });
    expect(screen.getByText(/No variables available/i)).toBeInTheDocument();
  });

  it('shows mapped input variable in the mapping row', () => {
    renderMapper({
      step: makeStep({
        config: { inputMappings: { topic: 'user_topic' } },
      }),
    });
    const html = document.body.innerHTML;
    expect(html).toContain('user_topic');
    expect(screen.getByText('1 unmapped')).toBeInTheDocument();
  });
});
