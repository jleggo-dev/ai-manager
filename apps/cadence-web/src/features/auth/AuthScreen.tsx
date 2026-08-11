import { useEffect, useState } from 'react';
import { supabase, authConfigured } from '../../lib/supabase.ts';
import {
  isNativeShell,
  linkProviderNative,
  signInWithProviderNative,
  type NativeOAuthProvider,
  AUTH_FAILED_EVENT,
  AUTH_SHEET_CLOSED_EVENT,
} from '../../lib/native-auth.ts';
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

/** Apple's mark for the sign-in button — their sanctioned use, and required to be the filled logo. */
const AppleLogo = () => (
  <svg viewBox="0 0 16 20" aria-hidden xmlns="http://www.w3.org/2000/svg" fill="currentColor">
    <path d="M13.29 10.6c-.02-2.2 1.8-3.26 1.88-3.31-1.02-1.5-2.61-1.7-3.18-1.72-1.35-.14-2.64.8-3.33.8-.69 0-1.75-.78-2.87-.76-1.48.02-2.84.86-3.6 2.18-1.53 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.25 2.74 2.2 1.1-.04 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.08 2.65-2.14.84-1.23 1.18-2.42 1.2-2.48-.03-.01-2.3-.88-2.32-3.5zM11.1 3.9c.6-.74 1.01-1.76.9-2.78-.87.04-1.93.58-2.56 1.31-.56.65-1.05 1.69-.92 2.69.97.07 1.96-.49 2.58-1.22z" />
  </svg>
);

/**
 * Pre-auth screen: continue with Google or Apple, or sign in / create an account with email +
 * password (all Supabase). On success, the session change is picked up by App's onAuthStateChange
 * listener, which swaps this out for the app — so there's no explicit onDone callback. For the
 * OAuth providers the browser redirects out and back; the client's detectSessionInUrl parses the
 * returned session, which fires the same listener. Copy stays in the coach's warm, plain voice.
 *
 * Account linking (decided 2026-08-06): one account per verified email, providers link into it.
 * Deliberately NOT promised in the copy — Apple's "Hide My Email" hands us a relay address that
 * won't match a Google email, so linking silently won't happen for those users, and copy that
 * promised it would be a lie for exactly the people who chose the private option.
 */
type Mode = 'signin' | 'signup';

/**
 * `gate` is the standalone sign-in screen. `upgrade` is the same providers behind the finished
 * plan (SignUpGate): the session already exists and is anonymous, so every path here LINKS to it
 * rather than starting a new one — otherwise agreeing to save the plan is what loses it.
 */
export type AuthScreenMode = 'gate' | 'upgrade';

function authErrorMessage(error: { message?: string } | null | undefined, fallback: string): string {
  const message = error?.message?.trim();
  return message || fallback;
}

/**
 * Supabase says this several ways depending on provider and on whether it surfaced from the link
 * call or came back on the deep link, so match on meaning rather than one exact string.
 */
function isAlreadyTakenMessage(message: string): boolean {
  return /already (been )?(registered|exists|linked|in use)|identity_already_exists|user_already_exists/i.test(message);
}

export function AuthScreen({ mode: screenMode = 'gate' }: { mode?: AuthScreenMode } = {}) {
  const upgrading = screenMode === 'upgrade';
  const [mode, setMode] = useState<Mode>(upgrading ? 'signup' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [notice, setNotice] = useState('');
  /**
   * The identity they just offered is already attached to ANOTHER account.
   *
   * Without a way out this is a dead end, and a real one: onboarding runs anonymously, the gate
   * only ever offers LINKING (linking is what keeps the plan attached to the id it was built on),
   * so "you already have an account" leaves someone unable to finish and unable to leave. The way
   * out has to be explicit, because it costs them this run.
   */
  const [existingAccount, setExistingAccount] = useState(false);

  async function continueWith(provider: NativeOAuthProvider) {
    if (busy) return;
    const label = provider === 'apple' ? 'Apple' : 'Google';
    setBusy(true);
    setMsg('');
    setNotice('');
    // Native shell: system browser sheet + cadence:// deep link (lib/native-auth.ts); the
    // appUrlOpen listener finishes the session, and App's auth listener takes over.
    if (isNativeShell()) {
      const errMsg = await (upgrading ? linkProviderNative(provider) : signInWithProviderNative(provider));
      if (errMsg) {
        if (isAlreadyTakenMessage(errMsg)) setExistingAccount(true);
        else setMsg(errMsg);
        setBusy(false);
        return;
      }
      // STAY BUSY while the sheet is up. This screen used to unlock the moment the sheet opened,
      // which let a second tap start a second flow — and each launch mints a fresh PKCE challenge
      // that overwrites the stored verifier, so the code the FIRST sheet comes back with can no
      // longer be exchanged. Two `provider=google` authorize calls five seconds apart is exactly
      // what a real trace showed, and the resulting failure was silent. The sheet closing or the
      // callback failing is what releases the button now (see the listeners below).
      return;
    }
    // Web: redirects the browser to the provider, then back to the app; the returned session is
    // parsed by the client (detectSessionInUrl) and App's listener takes over. No dev query param
    // to keep — this screen only renders in real-auth mode.
    const options = { redirectTo: window.location.origin };
    const { error } = upgrading
      ? await supabase.auth.linkIdentity({ provider, options })
      : await supabase.auth.signInWithOAuth({ provider, options });
    if (error) {
      setMsg(authErrorMessage(error, `Could not start ${label} sign-in — try again.`));
      setBusy(false);
      return;
    }
    // Success → the page is navigating to the provider; leave busy set (no inline continuation).
  }

  // The deep-link listener lives at module scope in lib/native-auth.ts and finishes long after
  // the tap, so it reports back by event. Without this the screen would sit locked behind a
  // dismissed sheet, or stay silent on a failed exchange.
  useEffect(() => {
    const onFailed = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail || '';
      if (isAlreadyTakenMessage(detail)) {
        setMsg('');
        setExistingAccount(true);
      } else {
        setMsg(detail || 'Could not finish signing in — try again.');
      }
      setBusy(false);
    };
    const onClosed = () => setBusy(false);
    window.addEventListener(AUTH_FAILED_EVENT, onFailed);
    window.addEventListener(AUTH_SHEET_CLOSED_EVENT, onClosed);
    return () => {
      window.removeEventListener(AUTH_FAILED_EVENT, onFailed);
      window.removeEventListener(AUTH_SHEET_CLOSED_EVENT, onClosed);
    };
  }, []);

  /**
   * Drop the anonymous session and land on the sign-in screen. Signing out is what returns the app
   * to its signed-out state, and App's auth listener does the rest — the same path as Settings'
   * sign-out, so there is no second notion of "logged out" to keep in step.
   *
   * This abandons the anonymous run, which is why it is never automatic and why the copy says so
   * before they tap.
   */
  async function leaveForSignIn() {
    setBusy(true);
    await supabase.auth.signOut().catch(() => undefined);
  }

  async function submit() {
    const e = email.trim();
    // Upgrading takes the email alone — see below for why there is no password field to require.
    if (busy || !e || (!password && !upgrading)) return;
    setBusy(true);
    setMsg('');
    setNotice('');

    if (mode === 'signup' && upgrading) {
      // Attach the email to the session already in hand. A fresh signUp would mint a SECOND user
      // and strand the plan they just agreed to keep.
      //
      // Email only, deliberately: Supabase will not set a password on an anonymous user until the
      // address is verified, so asking for one here would collect a password we then quietly fail
      // to save. They confirm the address, and "Change password" in Settings (the existing reset-
      // link flow) is how they add one — or they just keep using the provider they signed up with.
      const { error } = await supabase.auth.updateUser({ email: e });
      // The same dead end as the providers, reached by typing the address instead: this email is
      // already somebody's account, and linking is the only thing this screen does.
      if (error && isAlreadyTakenMessage(error.message ?? '')) {
        setExistingAccount(true);
        setBusy(false);
        return;
      }
      setMsg(error ? authErrorMessage(error, 'Something went wrong — try again.') : '');
      if (!error) setNotice('Check your email to confirm it — your week is saved either way.');
      setBusy(false);
      return;
    }

    if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({ email: e, password });
      if (error) {
        setMsg(authErrorMessage(error, 'Something went wrong — try again.'));
        setBusy(false);
        return;
      }
      // If email confirmation is on, there's no session yet — tell the user to check their inbox.
      if (!data.session) {
        setNotice('Check your email to confirm your account, then sign in.');
        setMode('signin');
      }
      setBusy(false);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email: e, password });
    if (error) {
      setMsg(authErrorMessage(error, 'Something went wrong — try again.'));
      setBusy(false);
      return;
    }
    // On success with a session, App's auth listener takes over from here.
    setBusy(false);
  }

  return (
    <div className={`welcome auth${upgrading ? ' auth-upgrade' : ''}`}>
      {/* In upgrade mode the plan behind the gate is the hero; a second wordmark above it would
          re-introduce the app just as someone is deciding to keep what it built. */}
      {!upgrading && (
        <div className="hero">
          <Orb hero />
          <div className="w-word">Cadence</div>
          <p className="w-tag">{mode === 'signin' ? 'Welcome back.' : 'A rhythm you can keep.'}</p>
        </div>
      )}

      <button className="auth-google" onClick={() => continueWith('google')} disabled={busy || !authConfigured}>
        <GoogleG />
        Continue with Google
      </button>
      {/* Apple is listed second but is NOT optional: App Review guideline 4.8 requires Sign in
          with Apple in any app offering third-party login. Apple's own guidelines require the
          exact wording "Continue with Apple" and the filled logo on a solid button. */}
      <button className="auth-apple" onClick={() => continueWith('apple')} disabled={busy || !authConfigured}>
        <AppleLogo />
        Continue with Apple
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
          onKeyDown={(ev) => upgrading && ev.key === 'Enter' && submit()}
          placeholder="Email"
          aria-label="Email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
        />
        {/* No password field at the gate: Supabase refuses to set one on an anonymous user until
            the address is verified, and a field whose value we can't save is worse than no field. */}
        {!upgrading && (
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
        )}
        {existingAccount && (
          <div className="auth-error auth-existing">
            <p>You already have an account with that. Sign in to it instead — this week won&rsquo;t carry over.</p>
            <button type="button" className="auth-existing-go" onClick={() => void leaveForSignIn()}>
              Sign in to that account
            </button>
          </div>
        )}
        {msg && <div className="auth-error">{msg}</div>}
        {!authConfigured && <div className="auth-error">{"Sign-in isn't configured yet (missing Supabase keys)."}</div>}
      </div>

      <button className="cta" onClick={submit} disabled={busy || !authConfigured}>
        {busy ? 'One moment…' : upgrading ? 'Save my week →' : mode === 'signin' ? 'Sign in →' : 'Create account →'}
      </button>
      {upgrading ? (
        // Decided 2026-08-06: one account per verified email, providers link into it. Said out
        // loud here because this is the screen where someone picks which provider to use.
        <div className="auth-foot">One account per email — providers link into it.</div>
      ) : (
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
      )}
    </div>
  );
}
