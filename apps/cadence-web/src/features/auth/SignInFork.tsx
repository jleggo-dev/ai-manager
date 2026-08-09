import { useState } from 'react';
import { Orb } from '../../components/Orb.tsx';
import { startAnonymousSession } from './anonymous.ts';

/**
 * The fork: new here, or coming back.
 *
 * This replaces the old two-beat welcome (a tagline, then "what should I call you?"). The name
 * question is gone from here on purpose — Cadence asks for it herself, in the conversation, where
 * she can also react to the answer. A form field that asks a question the coach is about to ask
 * again is the app and the coach failing to be the same thing.
 *
 * "Get started" opens an anonymous session and goes straight to meeting the coach; the sign-up
 * gate comes after the first week exists. If anonymous sessions aren't available, this falls back
 * to signing up first — the flow that shipped before — rather than dead-ending.
 *
 * The footer discloses the AI before anything else does. It is the first sentence of the product,
 * and it should be, because everything after it is a conversation with a machine.
 */
export function SignInFork({ onSignIn, onStarted }: { onSignIn: () => void; onStarted: () => void }) {
  const [busy, setBusy] = useState(false);

  async function start() {
    if (busy) return;
    setBusy(true);
    const result = await startAnonymousSession();
    setBusy(false);
    // 'unavailable' → the account has to come first after all; the provider sheet is that path.
    if (result === 'ok') onStarted();
    else onSignIn();
  }

  return (
    <div className="welcome fork">
      <div className="hero">
        <Orb hero />
        <div className="w-word">Cadence</div>
        <p className="w-tag">A rhythm you can keep.</p>
      </div>

      <div className="fork-acts">
        <div className="fork-block">
          <div className="fork-q">New to Cadence?</div>
          <button className="cta" onClick={start} disabled={busy}>
            {busy ? 'One moment…' : 'Get started'}
          </button>
        </div>
        <div className="auth-divider">
          <span>or</span>
        </div>
        <div className="fork-block">
          <div className="fork-q">Already have an account?</div>
          <button className="fork-signin" onClick={onSignIn} disabled={busy}>
            Sign in
          </button>
        </div>
      </div>

      <div className="fork-foot">{"Your coach is AI — you'll meet them in a moment."}</div>
    </div>
  );
}
