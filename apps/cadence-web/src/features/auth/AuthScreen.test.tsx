import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthScreen } from './AuthScreen.tsx';

const signUp = vi.fn();
const signInWithPassword = vi.fn();
const signInWithOAuth = vi.fn();

vi.mock('../../lib/supabase.ts', () => ({
  authConfigured: true,
  supabase: {
    auth: {
      signUp: (...args: unknown[]) => signUp(...args),
      signInWithPassword: (...args: unknown[]) => signInWithPassword(...args),
      signInWithOAuth: (...args: unknown[]) => signInWithOAuth(...args),
    },
  },
}));

describe('AuthScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signInWithPassword.mockResolvedValue({ error: null });
    signInWithOAuth.mockResolvedValue({ error: null });
  });

  it('toggles between sign-in and create-account modes', () => {
    render(<AuthScreen />);
    expect(screen.getByText('Welcome back.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in →' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New here? Create an account' }));
    expect(screen.getByText('A rhythm you can keep.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account →' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Already have an account? Sign in' }));
    expect(screen.getByText('Welcome back.')).toBeInTheDocument();
  });

  /**
   * Guideline 4.8 makes the Apple button a submission gate, not a feature — if it silently stops
   * rendering, the failure surfaces as an App Store rejection rather than anything visible here.
   */
  it('offers both OAuth providers, with Apple wired to the apple provider', async () => {
    render(<AuthScreen />);
    expect(screen.getByRole('button', { name: /Continue with Google/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Continue with Apple/ }));
    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({ provider: 'apple' })));
  });

  it('surfaces a provider-specific message when Apple sign-in fails to start', async () => {
    signInWithOAuth.mockResolvedValueOnce({ error: { message: '' } });
    render(<AuthScreen />);

    fireEvent.click(screen.getByRole('button', { name: /Continue with Apple/ }));
    // The fallback must name Apple, not Google — the old handler was hard-coded to one provider.
    await waitFor(() => expect(screen.getByText(/Could not start Apple sign-in/)).toBeInTheDocument());
  });

  it('signup without a session shows the check-your-email notice and flips to sign-in', async () => {
    signUp.mockResolvedValueOnce({ data: { session: null }, error: null });
    render(<AuthScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'New here? Create an account' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'you@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account →' }));

    await waitFor(() => expect(screen.getByText(/Check your email to confirm your account/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Sign in →' })).toBeInTheDocument();
    expect(signUp).toHaveBeenCalledWith({ email: 'you@example.com', password: 'secret-pass' });
  });
});
