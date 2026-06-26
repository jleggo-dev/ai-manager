import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import WorkflowHelpDrawer from './WorkflowHelpDrawer';

function renderDrawer(opened: boolean) {
  return render(
    <MantineProvider>
      <WorkflowHelpDrawer opened={opened} onClose={vi.fn()} />
    </MantineProvider>,
  );
}

describe('WorkflowHelpDrawer', () => {
  it('renders heading content when opened', () => {
    renderDrawer(true);
    expect(screen.getByText('What is a Workflow?')).toBeInTheDocument();
  });

  it('shows all major sections when opened', () => {
    renderDrawer(true);
    expect(screen.getByText('How Variables Work')).toBeInTheDocument();
    expect(screen.getByText('Dependencies')).toBeInTheDocument();
    expect(screen.getByText('Cross-Step Context')).toBeInTheDocument();
    expect(screen.getByText('Testing Workflows')).toBeInTheDocument();
    expect(screen.getByText('Integration Pattern')).toBeInTheDocument();
  });

  it('shows variable source badges', () => {
    renderDrawer(true);
    expect(screen.getByText('user')).toBeInTheDocument();
    expect(screen.getByText('pipeline')).toBeInTheDocument();
  });

  it('includes integration docs link', () => {
    renderDrawer(true);
    expect(screen.getByText(/View Full Integration Documentation/)).toBeInTheDocument();
  });

  it('does not render content when closed', () => {
    renderDrawer(false);
    expect(screen.queryByText('What is a Workflow?')).not.toBeInTheDocument();
  });
});
