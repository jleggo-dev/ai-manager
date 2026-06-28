import { useState } from 'react';
import { Box, Loader, Text, Title, Divider } from '@mantine/core';
import { signInWithGoogle } from '../../lib/auth-session';
import { isSupabaseConfigured } from '../../lib/supabase';
import GoogleGLogo from './GoogleGLogo';
import SignInForm from './SignInForm';
import SignUpForm from './SignUpForm';
import ForgotPasswordForm from './ForgotPasswordForm';
import styles from './AuthLanding.module.css';

const MODE = {
  signin: 'signin',
  signup: 'signup',
  forgot: 'forgot',
} as const;

type AuthMode = (typeof MODE)[keyof typeof MODE];

interface AuthLandingProps {
  onAuthenticated?: () => void;
}

export default function AuthLanding({ onAuthenticated }: AuthLandingProps) {
  const [mode, setMode] = useState<AuthMode>(MODE.signin);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configured = isSupabaseConfigured();

  const handleGoogle = async () => {
    setGoogleLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
      // Redirecting to Google — page unloads; spinner stays until navigation.
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleAuthSuccess = () => {
    onAuthenticated?.();
  };

  if (!configured) {
    return (
      <div className={styles.page}>
        <Box className={styles.configCard}>
          <div className={styles.configInner}>
            <Title order={4} c="#00104b" mb="sm">
              Configuration required
            </Title>
            <Text size="sm" c="dimmed">
              Supabase auth needs the anon key. Locally: set <code>VITE_SUPABASE_*</code> in <code>frontend/.env</code>,
              or <code>AI_MANAGER_SUPABASE_URL</code> and <code>AI_MANAGER_SUPABASE_ANON_KEY</code> in{' '}
              <code>backend/.env</code> (Vite maps them). On Vercel: ensure <code>AI_MANAGER_SUPABASE_URL</code> and{' '}
              <code>AI_MANAGER_SUPABASE_ANON_KEY</code> reach the <strong>frontend</strong> build, then redeploy.
            </Text>
          </div>
        </Box>
      </div>
    );
  }

  const googleLabel = mode === MODE.signup ? 'Sign up with Google' : 'Sign in with Google';
  const subtitle =
    mode === MODE.signup
      ? 'Create an account with email or Google'
      : mode === MODE.forgot
        ? 'Reset your password'
        : 'Sign in with email or Google';

  return (
    <div className={styles.page}>
      <Box className={styles.card}>
        <div className={styles.cardHeader}>
          <h1 className={styles.cardTitle}>AI Admin</h1>
          <p className={styles.cardSubtitle}>{subtitle}</p>
        </div>

        <div className={styles.cardBody}>
          {mode === MODE.forgot ? (
            <ForgotPasswordForm onBack={() => setMode(MODE.signin)} />
          ) : (
            <>
              <div className={styles.toggleRow} role="tablist" aria-label="Sign in or sign up">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === MODE.signin}
                  className={`${styles.toggleBtn} ${mode === MODE.signin ? styles.toggleBtnActive : styles.toggleBtnIdle}`}
                  onClick={() => setMode(MODE.signin)}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === MODE.signup}
                  className={`${styles.toggleBtn} ${mode === MODE.signup ? styles.toggleBtnActive : styles.toggleBtnIdle}`}
                  onClick={() => setMode(MODE.signup)}
                >
                  Sign Up
                </button>
              </div>

              {mode === MODE.signin ? (
                <SignInForm onForgotPassword={() => setMode(MODE.forgot)} onSuccess={handleAuthSuccess} />
              ) : (
                <SignUpForm onSuccess={handleAuthSuccess} />
              )}

              <Divider label="or" labelPosition="center" my="md" />

              <button
                type="button"
                className={styles.googleSignInButton}
                onClick={handleGoogle}
                disabled={googleLoading}
                aria-busy={googleLoading}
              >
                <span className={styles.googleSignInIconWrap}>
                  {googleLoading ? <Loader size={20} color="#5f6368" /> : <GoogleGLogo size={20} />}
                </span>
                <span className={styles.googleSignInLabel}>{googleLabel}</span>
              </button>
            </>
          )}

          {error ? (
            <Text size="sm" c="red" className={styles.errorBox}>
              {error}
            </Text>
          ) : null}
        </div>
      </Box>
    </div>
  );
}
