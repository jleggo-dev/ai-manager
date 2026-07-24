import { useState } from 'react';
import { supabase, authConfigured } from '../../lib/supabase.ts';
import { Orb } from '../../components/Orb.tsx';

/** Google's brand "G" for the sign-in button (their sanctioned use for exactly this). */
const GoogleG = () => (
  <svg viewBox="0 0 18 18" aria-hidden xmlns="http://www.w3.org/2000/svg">
    <path
      fill="#4285F4"
      d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z"
    />
    <path
      fill="#34A853"
      d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
    />
    <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
    <path
      fill="#EA4335"
      d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
    />
  </svg>
);

/**
 * Pre-auth screen: continue with Google, or sign in / create an account with email + password
 * (all Supabase). On success, the session change is picked up by App's onAuthStateChange listener,
 * which swaps this out for the app — so there's no explicit onDone callback. For Google, the browser
 * redirects to Google and back; the client's detectSessionInUrl parses the returned session, which
 * fires the same listener. Copy stays in the coach's warm, plain voice.
 */
type Mode = 'signin' | 'signup';

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [notice, setNotice] = useState('');

  async function continueWithGoogle() {
    if (busy) return;
    setBusy(true);
    setMsg('');
    setNotice('');
    try {
      // Redirects the browser to Google, then back to the app; the returned session is parsed by
      // the client (detectSessionInUrl) and App's listener takes over. No dev query param to keep —
      // this screen only renders in real-auth mode.
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
      // Success → the page is navigating to Google; leave busy set (no inline continuation).
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Could not start Google sign-in — try again.');
      setBusy(false);
    }
  }

  async function submit() {
    const e = email.trim();
    if (busy || !e || !password) return;
    setBusy(true);
    setMsg('');
    setNotice('');
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email: e, password });
        if (error) throw error;
        // If email confirmation is on, there's no session yet — tell the user to check their inbox.
        if (!data.session) {
          setNotice('Check your email to confirm your account, then sign in.');
          setMode('signin');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: e, password });
        if (error) throw error;
      }
      // On success with a session, App's auth listener takes over from here.
    } catch (err) {
      const m = err instanceof Error ? err.message : 'Something went wrong — try again.';
      setMsg(m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="welcome auth">
      <div className="hero">
        <Orb hero />
        <div className="w-word">Cadence</div>
        <p className="w-tag">Build better habits.</p>
      </div>

      <button className="auth-google" onClick={continueWithGoogle} disabled={busy || !authConfigured}>
        <GoogleG />
        Continue with Google
      </button>
      <div className="auth-divider">
        <span>or</span>
      </div>

      <div className="auth-form">
        {notice && <div className="auth-notice">{notice}</div>}
        <input
          className="field"
          type="email"
          value={email}
          onChange={(ev) => setEmail(ev.target.value)}
          placeholder="Email"
          aria-label="Email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
        />
        <input
          className="field"
          type="password"
          value={password}
          onChange={(ev) => setPassword(ev.target.value)}
          onKeyDown={(ev) => ev.key === 'Enter' && submit()}
          placeholder="Password"
          aria-label="Password"
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
        />
        {msg && <div className="auth-error">{msg}</div>}
        {!authConfigured && <div className="auth-error">{"Sign-in isn't configured yet (missing Supabase keys)."}</div>}
      </div>

      <button className="cta" onClick={submit} disabled={busy || !authConfigured}>
        {busy ? 'One moment…' : mode === 'signin' ? 'Sign in →' : 'Create account →'}
      </button>
      <button
        className="auth-toggle"
        onClick={() => {
          setMode(mode === 'signin' ? 'signup' : 'signin');
          setMsg('');
          setNotice('');
        }}
      >
        {mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}
      </button>
    </div>
  );
}
