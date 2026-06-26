import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import WorkflowStepSidebar, { type SidebarStepItem } from './WorkflowStepSidebar';

const mockSteps: SidebarStepItem[] = [
  { _uid: 'uid-1', step_key: 'draft', name: 'Draft Content', processing_job_id: 'job-1', is_required: true },
  { _uid: 'uid-2', step_key: 'review', name: 'Review Content', processing_job_id: 'job-2', is_required: false },
  { _uid: 'uid-3', step_key: 'publish', name: 'Publish', processing_job_id: null },
];

function renderSidebar(
  overrides: {
    steps?: SidebarStepItem[];
    selectedId?: string | null;
    onSelect?: (id: string | null) => void;
    onAddStep?: () => void;
    onMoveStep?: (index: number, direction: number) => void;
    onRemoveStep?: (index: number) => void;
  } = {},
) {
  const onSelect = overrides.onSelect ?? vi.fn();
  const onAddStep = overrides.onAddStep ?? vi.fn();
  const onMoveStep = overrides.onMoveStep ?? vi.fn();
  const onRemoveStep = overrides.onRemoveStep ?? vi.fn();
  const props = {
    steps: overrides.steps ?? mockSteps,
    selectedId: overrides.selectedId ?? null,
    onSelect,
    onAddStep,
    onMoveStep,
    onRemoveStep,
  };
  return {
    onSelect,
    onAddStep,
    onMoveStep,
    onRemoveStep,
    ...render(
      <MantineProvider>
        <WorkflowStepSidebar {...props} />
      </MantineProvider>,
    ),
  };
}

describe('WorkflowStepSidebar', () => {
  it('renders Application Call entry', () => {
    renderSidebar();
    expect(screen.getByText('Application Call')).toBeInTheDocument();
    expect(screen.getByText('Workflow config')).toBeInTheDocument();
  });

  it('renders all step names with step numbers', () => {
    renderSidebar();
    expect(screen.getByText(/Step 1.*Draft Content/)).toBeInTheDocument();
    expect(screen.getByText(/Step 2.*Review Content/)).toBeInTheDocument();
    expect(screen.getByText(/Step 3.*Publish/)).toBeInTheDocument();
  });

  it('shows step keys', () => {
    renderSidebar();
    expect(screen.getByText('draft')).toBeInTheDocument();
    expect(screen.getByText('review')).toBeInTheDocument();
    expect(screen.getByText('publish')).toBeInTheDocument();
  });

  it('shows "No job" badge when processing_job_id is null', () => {
    renderSidebar();
    expect(screen.getByText('No job')).toBeInTheDocument();
  });

  it('shows "Required" badge for required steps', () => {
    renderSidebar();
    expect(screen.getByText('Required')).toBeInTheDocument();
  });

  it('calls onSelect(null) when Application Call is clicked', () => {
    const onSelect = vi.fn();
    renderSidebar({ onSelect });
    fireEvent.click(screen.getByText('Application Call'));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('calls onSelect with step _uid when step is clicked', () => {
    const onSelect = vi.fn();
    renderSidebar({ onSelect });
    fireEvent.click(screen.getByText(/Step 2.*Review Content/));
    expect(onSelect).toHaveBeenCalledWith('uid-2');
  });

  it('calls onAddStep when Add Step is clicked', () => {
    const onAddStep = vi.fn();
    renderSidebar({ onAddStep });
    fireEvent.click(screen.getByText('Add Step'));
    expect(onAddStep).toHaveBeenCalledTimes(1);
  });

  it('renders empty sidebar when no steps', () => {
    renderSidebar({ steps: [] });
    expect(screen.getByText('Application Call')).toBeInTheDocument();
    expect(screen.getByText('Add Step')).toBeInTheDocument();
    expect(screen.queryByText(/Step 1/)).not.toBeInTheDocument();
  });
});
