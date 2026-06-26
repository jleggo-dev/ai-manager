import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ErrorBoundary } from './ErrorBoundary';

function BrokenComponent(): never {
  throw new Error('Test error');
}

const originalConsoleError = console.error;

beforeAll(() => {
  console.error = (...args: unknown[]) => {
    const msg = typeof args[0] === 'string' ? args[0] : '';
    if (msg.includes('[ErrorBoundary]') || msg.includes('Error: Uncaught')) return;
    originalConsoleError(...args);
  };
});

afterAll(() => {
  console.error = originalConsoleError;
});

function renderWithProvider(ui: React.ReactElement) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe('ErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    renderWithProvider(
      <ErrorBoundary>
        <p>All good</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('shows "Something went wrong" when a child throws', () => {
    renderWithProvider(
      <ErrorBoundary>
        <BrokenComponent />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('shows the error message in the fallback UI', () => {
    renderWithProvider(
      <ErrorBoundary>
        <BrokenComponent />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Test error')).toBeInTheDocument();
  });

  it('resets error state and renders children when "Try Again" is clicked', () => {
    let shouldThrow = true;

    function MaybeBroken() {
      if (shouldThrow) throw new Error('Conditional error');
      return <p>Recovered</p>;
    }

    renderWithProvider(
      <ErrorBoundary>
        <MaybeBroken />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(screen.getByText('Recovered')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });
});
