import { useState } from 'react';
import { Box, Loader, Text, Title } from '@mantine/core';
import { signInWithGoogle } from '../../lib/auth-session';
import { isSupabaseConfigured } from '../../lib/supabase';
import GoogleGLogo from './GoogleGLogo';
import styles from './AuthLanding.module.css';

const MODE = {
  signin: 'signin',
  signup: 'signup',
} as const;

type AuthMode = (typeof MODE)[keyof typeof MODE];

export default function AuthLanding() {
  const [mode, setMode] = useState<AuthMode>(MODE.signin);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configured = isSupabaseConfigured();

  const handleGoogle = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setLoading(false);
    }
  };

  if (!configured) {
    return (
      <div className={styles.page}>
        <div className={styles.brand}>
          <img src="/appdirect-logo.png" alt="AppDirect" />
        </div>
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

  const googleLabel = mode === MODE.signin ? 'Sign in with Google' : 'Sign up with Google';

  return (
    <div className={styles.page}>
      <div className={styles.brand}>
        <img src="/appdirect-logo.png" alt="AppDirect" />
      </div>

      <Box className={styles.card}>
        <div className={styles.cardHeader}>
          <h1 className={styles.cardTitle}>AI Admin</h1>
          <p className={styles.cardSubtitle}>Use your Google account to continue</p>
        </div>

        <div className={styles.cardBody}>
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

          <button
            type="button"
            className={styles.googleSignInButton}
            onClick={handleGoogle}
            disabled={loading}
            aria-busy={loading}
          >
            <span className={styles.googleSignInIconWrap}>
              {loading ? <Loader size={20} color="#5f6368" /> : <GoogleGLogo size={20} />}
            </span>
            <span className={styles.googleSignInLabel}>{googleLabel}</span>
          </button>

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
