import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import PageHeader from './PageHeader';

function renderWithProvider(ui: React.ReactElement) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe('PageHeader', () => {
  it('renders the title text', () => {
    renderWithProvider(<PageHeader title="Dashboard" />);

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    renderWithProvider(<PageHeader title="Settings" description="Manage your preferences" />);

    expect(screen.getByText('Manage your preferences')).toBeInTheDocument();
  });

  it('does not render description when not provided', () => {
    renderWithProvider(<PageHeader title="Settings" />);

    expect(screen.queryByText('Manage your preferences')).not.toBeInTheDocument();
  });

  it('renders children in the action area', () => {
    renderWithProvider(
      <PageHeader title="Users">
        <button>Add User</button>
      </PageHeader>,
    );

    expect(screen.getByRole('button', { name: /add user/i })).toBeInTheDocument();
  });
});
